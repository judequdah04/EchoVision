import sys, os, base64, json, asyncio
sys.path.insert(0, "/workspace/echovision")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional
import numpy as np
import cv2
from PIL import Image

from core.model_loader import load_all_models, warmup_models
from core.config import *
from core.tts import speak
from core.voice_pipeline import transcribe_audio, validate_transcript, parse_command
from modules.describe import run_describe
from modules.recognize import run_recognize
from modules.identify import run_identify, db_lookup
from modules.where import run_where
from modules.find import (run_find_scan, run_find_walk_frame, run_obstacle_check,
                           run_sticker_validate, setup_sticker, get_sticker_profile)

app = FastAPI(title="EchoVision API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
models = {}

@app.on_event("startup")
async def startup():
    global models
    print("Loading all models...")
    models = load_all_models()
    warmup_models(models)
    print("Server ready.")

def decode_frame(b64_string):
    img_bytes = base64.b64decode(b64_string)
    img_arr   = np.frombuffer(img_bytes, np.uint8)
    img_bgr   = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    img_rgb   = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(img_rgb), img_bgr

def frames_changed(prev, curr, threshold=30.0):
    if prev is None: return True
    prev_gray = cv2.cvtColor(np.array(prev), cv2.COLOR_RGB2GRAY)
    curr_gray = cv2.cvtColor(np.array(curr), cv2.COLOR_RGB2GRAY)
    diff = cv2.absdiff(cv2.resize(prev_gray, (160, 120)), cv2.resize(curr_gray, (160, 120)))
    return float(diff.mean()) > threshold

# ── Pydantic Models ───────────────────────────────────────────────────────────

class FramesRequest(BaseModel):
    frames: list[str]
    language: str = "english"
    user_id: str = "shared"

class IdentifyRequest(BaseModel):
    item_name: str
    location: str
    language: str = "english"
    user_id: str = "shared"

class WhereRequest(BaseModel):
    item_name: str
    language: str = "english"
    user_id: str = "shared"

class FindScanRequest(BaseModel):
    item_name: str
    frames: list[str] = []
    frame: str = ""
    language: str = "english"
    scan_attempt: int = 1
    user_id: str = "shared"

class StickerSetupRequest(BaseModel):
    color: str
    shape: str
    user_id: str = "shared"

class RegisterFaceRequest(BaseModel):
    name: str
    frames: list[str]
    user_id: str = "shared"

class STTRequest(BaseModel):
    audio_b64: str
    language_code: str = "en"

class ProcessCommandRequest(BaseModel):
    transcript: str
    language: str = "english"
    frames: list[str] = []
    frame: str = ""

class TTSRequest(BaseModel):
    text: str
    language: str = "english"

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": len(models) > 0}

# ── STT ───────────────────────────────────────────────────────────────────────

@app.post("/stt")
async def stt(req: STTRequest):
    try:
        transcript = transcribe_audio(req.audio_b64, req.language_code)
        return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(500, f"STT error: {str(e)}")

# ── Process Command ───────────────────────────────────────────────────────────

@app.post("/process_command")
async def process_command(req: ProcessCommandRequest):
    if not models: raise HTTPException(503, "Models not loaded yet")
    validation = validate_transcript(req.transcript)
    if validation == "stop":
        audio_b64, _ = speak("Goodbye.", req.language)
        return {"status": "stop", "text": "Goodbye.", "audio": audio_b64, "keyword": None}
    if validation == "invalid":
        msg = "I did not understand. Please say: describe, recognize, identify, where, or find."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "invalid", "text": msg, "audio": audio_b64, "keyword": None}
    parsed = parse_command(req.transcript)
    if parsed is None:
        msg = "I did not understand. Please say one command at a time."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "invalid", "text": msg, "audio": audio_b64, "keyword": None}
    keyword  = parsed["keyword"]
    obj      = parsed["object"]
    location = parsed["location"]
    if keyword == "stop":
        audio_b64, _ = speak("Goodbye.", req.language)
        return {"status": "stop", "text": "Goodbye.", "audio": audio_b64, "keyword": "stop"}
    if keyword == "identify" and not location:
        msg = "Please also tell me the location. For example: identify my wallet in the kitchen."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "need_location", "text": msg, "audio": audio_b64, "keyword": keyword, "object": obj}
    if keyword == "find" and not obj:
        msg = "Please tell me what to find. For example: find my wallet."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "need_object", "text": msg, "audio": audio_b64, "keyword": keyword}
    if keyword == "where" and not obj:
        msg = "Please tell me what you are looking for. For example: where is my wallet."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "need_object", "text": msg, "audio": audio_b64, "keyword": keyword}
    try:
        if keyword == "describe":
            frames = []
            for b64 in req.frames:
                try:
                    img_pil, _ = decode_frame(b64)
                    frames.append(img_pil)
                except: pass
            if not frames:
                msg = "No image received. Please point your camera and try again."
                audio_b64, _ = speak(msg, req.language)
                return {"status": "error", "text": msg, "audio": audio_b64, "keyword": keyword}
            text = run_describe(frames, models)
        elif keyword == "recognize":
            frames = []
            for b64 in req.frames:
                try:
                    img_pil, _ = decode_frame(b64)
                    frames.append(np.array(img_pil))
                except: pass
            if not frames:
                msg = "No image received. Please point your camera and try again."
                audio_b64, _ = speak(msg, req.language)
                return {"status": "error", "text": msg, "audio": audio_b64, "keyword": keyword}
            text = run_recognize(frames, models, req.user_id)
        elif keyword == "identify":
            text = run_identify(obj, location)
        elif keyword == "where":
            text = run_where(obj)
        elif keyword == "find":
            if not req.frame:
                msg = "No scan frame received. Please point your camera at the room and try again."
                audio_b64, _ = speak(msg, req.language)
                return {"status": "error", "text": msg, "audio": audio_b64, "keyword": keyword}
            _, frame_bgr = decode_frame(req.frame)
            result = run_find_scan(obj, frame_bgr, models)
            text = result["message"]
            audio_b64, spoken = speak(text, req.language)
            return {"status": "success", "text": spoken, "audio": audio_b64, "keyword": keyword,
                    "object": obj, "find_result": result}
        audio_b64, spoken_text = speak(text, req.language)
        return {"status": "success", "text": spoken_text, "audio": audio_b64,
                "keyword": keyword, "object": obj, "location": location}
    except Exception as e:
        msg = "Sorry, something went wrong. Please try again."
        audio_b64, _ = speak(msg, req.language)
        return {"status": "error", "text": msg, "audio": audio_b64, "keyword": keyword, "detail": str(e)}

# ── Describe ──────────────────────────────────────────────────────────────────

@app.post("/describe")
async def describe(req: FramesRequest):
    if not models: raise HTTPException(503, "Models not loaded yet")
    frames = []
    for b64 in req.frames:
        try:
            img_pil, _ = decode_frame(b64)
            frames.append(img_pil)
        except: pass
    if not frames: raise HTTPException(400, "No valid frames provided")
    text = run_describe(frames, models)
    audio_b64, spoken_text = speak(text, req.language)
    return {"text": spoken_text, "audio": audio_b64}

# ── Recognize ─────────────────────────────────────────────────────────────────

@app.post("/recognize")
async def recognize(req: FramesRequest):
    if not models: raise HTTPException(503, "Models not loaded yet")
    frames = []
    for b64 in req.frames:
        try:
            img_pil, _ = decode_frame(b64)
            frames.append(np.array(img_pil))
        except: pass
    if not frames: raise HTTPException(400, "No valid frames provided")
    text = run_recognize(frames, models, req.user_id)
    audio_b64, spoken_text = speak(text, req.language)
    return {"text": spoken_text, "audio": audio_b64}

# ── Identify ──────────────────────────────────────────────────────────────────

@app.post("/identify")
async def identify(req: IdentifyRequest):
    text = run_identify(req.item_name, req.location, req.user_id)
    audio_b64, spoken_text = speak(text, req.language)
    return {"text": spoken_text, "audio": audio_b64}

# ── Where ─────────────────────────────────────────────────────────────────────

@app.post("/where")
async def where(req: WhereRequest):
    text = run_where(req.item_name, req.user_id)
    audio_b64, spoken_text = speak(text, req.language)
    return {"text": spoken_text, "audio": audio_b64}

# ── Check Registered ─────────────────────────────────────────────────────────

class CheckRegisteredRequest(BaseModel):
    item_name: str
    user_id: str = "shared"

@app.post("/check_registered")
async def check_registered(req: CheckRegisteredRequest):
    record = db_lookup(req.item_name, req.user_id)
    if record is None:
        return {"registered": False}
    return {"registered": True}

# ── Find Scan ─────────────────────────────────────────────────────────────────

@app.post("/find/scan")
async def find_scan(req: FindScanRequest):
    if not models: raise HTTPException(503, "Models not loaded yet")
    frames_bgr = []
    for b64 in req.frames:
        try:
            _, frame_bgr = decode_frame(b64)
            frames_bgr.append(frame_bgr)
        except: pass
    if not frames_bgr and req.frame:
        try:
            _, frame_bgr = decode_frame(req.frame)
            frames_bgr.append(frame_bgr)
        except: pass
    if not frames_bgr:
        raise HTTPException(400, "No valid frames provided")
    result = run_find_scan(req.item_name, frames_bgr, models, scan_attempt=req.scan_attempt, user_id=req.user_id)
    audio_b64, spoken_text = speak(result["message"], req.language)
    result["audio"]        = audio_b64
    result["spoken_text"]  = spoken_text
    return result

# ── Sticker ───────────────────────────────────────────────────────────────────

@app.post("/sticker/setup")
async def sticker_setup(req: StickerSetupRequest):
    result = setup_sticker(req.color, req.shape, req.user_id)
    return {"result": result}

@app.get("/sticker/profile")
async def sticker_profile(user_id: str = "shared"):
    profile = get_sticker_profile(user_id)
    return {"profile": profile}

# ── Register Face ─────────────────────────────────────────────────────────────

@app.post("/register_face")
async def register_face(req: RegisterFaceRequest):
    if not models: raise HTTPException(503, "Models not loaded yet")
    if not req.name or not req.frames: raise HTTPException(400, "Name and frames required")
    embeddings = []
    for b64 in req.frames:
        try:
            img_pil, img_bgr = decode_frame(b64)
            faces = models["face_app"].get(img_bgr)
            for face in faces:
                if face.det_score >= 0.75:
                    embeddings.append(face.normed_embedding)
        except: pass
    if not embeddings:
        return {"status": "error", "message": "No faces detected in provided frames"}
    avg_embedding = np.mean(embeddings, axis=0)
    avg_embedding = avg_embedding / np.linalg.norm(avg_embedding)
    import uuid
    vector_id = f"{req.name}_{uuid.uuid4().hex[:8]}"
    models["pinecone"].upsert(
        vectors=[{"id": vector_id, "values": avg_embedding.tolist(), "metadata": {"name": req.name}}],
        namespace=req.user_id
    )
    return {"status": "success", "message": f"{req.name} registered successfully"}

# ── Find Walk WebSocket ───────────────────────────────────────────────────────

@app.websocket("/find/walk")
async def find_walk(websocket: WebSocket):
    await websocket.accept()
    item_name              = None
    target_box             = None
    excluded_boxes         = []
    prev_frame             = None
    language               = "english"
    obstacle_pause_until   = 0.0   # walk hints suppressed until this time
    obstacle_active        = False  # True while obstacle sequence is playing
    item_reached           = False  # True once item is reached — no more obstacles

    try:
        # ── Init ──────────────────────────────────────────────────────────
        init_data      = await websocket.receive_json()
        item_name      = init_data.get("item_name", "")
        target_box     = init_data.get("target_box", None)
        excluded_boxes = init_data.get("excluded_boxes", [])
        language       = init_data.get("language", "english")
        user_id        = init_data.get("user_id", "shared")

        if not item_name:
            await websocket.send_json({"status": "error", "message": "item_name required"})
            return

        # ── Ready ─────────────────────────────────────────────────────────
        msg = f"Ready to guide you to your {item_name}."
        audio_b64, _ = speak(msg, language)
        await websocket.send_json({"status": "ready", "message": msg, "audio": audio_b64})
        # Grace period — don't check obstacles for first 3s so user can start walking
        obstacle_pause_until = asyncio.get_event_loop().time() + 3.0

        # ── Main loop ─────────────────────────────────────────────────────
        while True:
            data   = await websocket.receive_json()
            action = data.get("action", "frame")

            if action == "stop":
                await websocket.send_json({"status": "stopped"})
                break

            # ── Obstacle check ────────────────────────────────────────────
            if action == "obstacle_frame":
                # Never check obstacles once item is reached
                if item_reached:
                    continue

                b64 = data.get("frame", "")
                if not b64:
                    continue
                try:
                    img_pil, frame_bgr = decode_frame(b64)
                except:
                    continue

                now     = asyncio.get_event_loop().time()

                # Skip if we're still in obstacle cooldown
                if obstacle_active or now < obstacle_pause_until:
                    continue

                warning = run_obstacle_check(frame_bgr, target_box, excluded_boxes, models, item_name=item_name)
                if warning:
                    obstacle_active = True

                    # Step 1 — say "Stop"
                    stop_audio, _ = speak("Stop.", language)
                    await websocket.send_json({
                        "status":   "obstacle",
                        "obstacle": "Stop.",
                        "audio":    stop_audio,
                    })

                    # Wait 2 seconds
                    await asyncio.sleep(2.0)

                    # Step 2 — say the direction (move left/right)
                    dir_audio, _ = speak(warning, language)
                    await websocket.send_json({
                        "status":   "obstacle",
                        "obstacle": warning,
                        "audio":    dir_audio,
                    })

                    # Suppress walk hints for 4s after obstacle
                    obstacle_pause_until = asyncio.get_event_loop().time() + 4.0
                    obstacle_active      = False

                continue

            # ── Item tracking frame ───────────────────────────────────────
            if action != "frame":
                continue

            b64 = data.get("frame", "")
            if not b64:
                continue

            try:
                img_pil, frame_bgr = decode_frame(b64)
            except:
                continue

            if not frames_changed(prev_frame, img_pil):
                await websocket.send_json({"status": "unchanged"})
                continue
            prev_frame = img_pil

            result = run_find_walk_frame(
                item_name, frame_bgr, target_box, excluded_boxes, models
            )

            if result.get("new_target_box"):
                target_box = result["new_target_box"]

            # Suppress walk direction hints while obstacle is being handled
            # BUT never suppress the "reached" message — always speak it
            now      = asyncio.get_event_loop().time()
            item_msg = result.get("message")
            if now < obstacle_pause_until and result["status"] != "reached":
                item_msg = None   # silent — obstacle just played

            audio_b64 = None
            if item_msg:
                audio_b64, _ = speak(item_msg, language)

            response = {
                "status":  result["status"],
                "message": item_msg,
            }
            if audio_b64:
                response["audio"] = audio_b64
            await websocket.send_json(response)

            # ── Item reached — stop all obstacles, switch to sticker loop ──
            if result["status"] == "reached":
                item_reached    = True   # kills all future obstacle checks
                obstacle_active = False

                while True:
                    sticker_data = await websocket.receive_json()

                    if sticker_data.get("action") == "stop":
                        break

                    if sticker_data.get("action") != "sticker_frame":
                        continue

                    b64 = sticker_data.get("frame", "")
                    if not b64:
                        continue

                    try:
                        _, frame_bgr = decode_frame(b64)
                    except:
                        continue

                    sticker_result = run_sticker_validate(frame_bgr, item_name=item_name)

                    # Still collecting — send silent status, no TTS
                    if sticker_result["status"] == "collecting":
                        await websocket.send_json({
                            "status":   "collecting",
                            "progress": sticker_result.get("progress", 0),
                        })
                        continue

                    # confirmed or not_confirmed — speak and send
                    audio_b64 = None
                    if sticker_result["message"]:
                        audio_b64, _ = speak(sticker_result["message"], language)

                    await websocket.send_json({
                        "status":    sticker_result["status"],
                        "confirmed": sticker_result["confirmed"],
                        "message":   sticker_result["message"],
                        "audio":     audio_b64,
                    })

                    if sticker_result["confirmed"]:
                        break

                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"status": "error", "message": str(e)})
        except:
            pass

# ── Test Page ─────────────────────────────────────────────────────────────────

@app.get("/test")
async def test_page():
    return HTMLResponse(open("/workspace/echovision/test.html").read())

# ── Wake Word WebSocket ───────────────────────────────────────────────────────

@app.websocket("/wake")
async def wake_word(websocket: WebSocket):
    await websocket.accept()
    from openwakeword.model import Model
    oww_model = Model(
        wakeword_models=["/workspace/echovision/models/hey_suji.onnx"],
        inference_framework="onnx"
    )
    CHUNK     = 1280
    THRESHOLD = 0.5
    try:
        while True:
            data        = await websocket.receive_bytes()
            audio_chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio_chunk) < CHUNK:
                continue
            prediction = oww_model.predict(audio_chunk)
            score      = list(prediction.values())[0]
            if score >= THRESHOLD:
                await websocket.send_json({"wake": True, "score": float(score)})
                oww_model.reset()
            else:
                await websocket.send_json({"wake": False, "score": float(score)})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        except:
            pass

# ── TTS ───────────────────────────────────────────────────────────────────────

@app.post("/tts")
async def tts_endpoint(req: TTSRequest):
    audio_b64, spoken = speak(req.text, req.language)
    return {"audio": audio_b64, "text": spoken}

# ── Wake STT ──────────────────────────────────────────────────────────────────

@app.post("/wake_stt")
async def wake_stt(req: STTRequest):
    try:
        transcript = transcribe_audio(req.audio_b64, req.language_code)
        text       = transcript.lower().strip()
        detected   = any(w in text for w in ["suji", "hey suji", "soji", "hey soji", "souji", "susie"])
        return {"transcript": transcript, "wake": detected}
    except Exception as e:
        return {"transcript": "", "wake": False}
