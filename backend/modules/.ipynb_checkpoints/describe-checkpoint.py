import cv2, torch, numpy as np, time, json
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import sys
sys.path.insert(0, "/workspace/echovision")
from core.config import *

# ─────────────────────────────────────────────────────────────────────────────
# GEOMETRY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _iou(boxA, boxB):
    xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
    interW = max(0, xB - xA); interH = max(0, yB - yA)
    interArea = interW * interH
    if interArea == 0: return 0.0
    areaA = (boxA[2]-boxA[0]) * (boxA[3]-boxA[1])
    areaB = (boxB[2]-boxB[0]) * (boxB[3]-boxB[1])
    return interArea / float(areaA + areaB - interArea)

def _is_contained(boxA, boxB, threshold=0.85):
    xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
    interW = max(0, xB - xA); interH = max(0, yB - yA)
    interArea = interW * interH
    areaA = (boxA[2]-boxA[0]) * (boxA[3]-boxA[1])
    if areaA == 0: return False
    return (interArea / areaA) >= threshold

def _deduplicate(dets, iou_threshold=0.3):
    dets = sorted(dets, key=lambda d: d["conf"], reverse=True)
    kept = []
    for det in dets:
        duplicate = False
        for k in kept:
            if k["label"] == det["label"]:
                if _iou(k["box_xyxy"], det["box_xyxy"]) > iou_threshold:
                    duplicate = True; break
                if _is_contained(det["box_xyxy"], k["box_xyxy"]):
                    duplicate = True; break
        if not duplicate:
            kept.append(det)
    return kept

# ─────────────────────────────────────────────────────────────────────────────
# DEPTH + POSITION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _depth_score(depth_map, box, W, H):
    x1,y1,x2,y2 = int(max(0,box[0])),int(max(0,box[1])),int(min(W-1,box[2])),int(min(H-1,box[3]))
    if x2<=x1 or y2<=y1: return 0.0
    patch = depth_map[y1:y2, x1:x2]
    return float(np.median(patch)) if patch.size > 0 else 0.0

def _depth_label(s): return "near" if s>=0.55 else "mid" if s>=0.30 else "far"

def _pos_label(cx, cy, W, H):
    vert  = "top"    if cy < H/3 else "middle" if cy < 2*H/3 else "bottom"
    horiz = "left"   if cx < W/3 else "center" if cx < 2*W/3 else "right"
    return vert, horiz

def _map_label(label):
    return RELTR_SYNONYMS.get(label.strip().lower(), label.strip().lower())

# ─────────────────────────────────────────────────────────────────────────────
# RELATIONSHIP HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _filter_rels(rels, yolo_dets):
    detected = set(d["label"].lower() for d in yolo_dets)
    # Expand aliases exactly as in Colab
    if "person" in detected:
        detected.update(["man","woman","boy","girl","child","kid","lady","guy","people","player","skier","men"])
    if "cup" in detected or "wine glass" in detected:
        detected.update(["glass","mug","drink"])
    if "table" in detected:
        detected.update(["desk","counter"])
    return [r for r in rels if r["subject"] in detected or r["object"] in detected]

def _clean_rels(rels, max_rels=12):
    seen, out = set(), []
    for r in sorted(rels, key=lambda x: x.get("score",0), reverse=True):
        key = (r["subject"], r["predicate"], r["object"])
        if key not in seen:
            seen.add(key)
            out.append({k:r[k] for k in ["subject","predicate","object","score"]})
        if len(out) >= max_rels: break
    return out

# ─────────────────────────────────────────────────────────────────────────────
# YOLO
# ─────────────────────────────────────────────────────────────────────────────

def run_yolo(img, models, conf=CONF_THRESHOLD, iou=IOU_THRESHOLD):
    dets = []
    for model in [models["coco_yolo"], models["custom_yolo"]]:
        res = model.predict(img, conf=conf, iou=iou, verbose=False)[0]
        if res.boxes is not None:
            for (x1,y1,x2,y2),c,k in zip(res.boxes.xyxy.cpu().numpy(),
                                           res.boxes.conf.cpu().numpy(),
                                           res.boxes.cls.cpu().numpy().astype(int)):
                dets.append({"label":res.names[k],"conf":float(c),
                             "box_xyxy":[float(x1),float(y1),float(x2),float(y2)]})
    return dets

# ─────────────────────────────────────────────────────────────────────────────
# MIDAS
# ─────────────────────────────────────────────────────────────────────────────

@torch.no_grad()
def run_midas(img_pil, models):
    inp  = models["midas_transform"](np.array(img_pil)).to(DEVICE)
    pred = models["midas"](inp)
    pred = torch.nn.functional.interpolate(
        pred.unsqueeze(1), size=img_pil.size[::-1],
        mode="bicubic", align_corners=False).squeeze()
    d = pred.detach().float().cpu().numpy()
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    return (np.clip(d, lo, hi) - lo) / (hi - lo + 1e-8)

# ─────────────────────────────────────────────────────────────────────────────
# RELTR — exact same inference as Colab run_reltr_official
# ─────────────────────────────────────────────────────────────────────────────

@torch.no_grad()
def run_reltr(img_pil, models):
    transform = models["reltr_transform"]
    img_t     = transform(img_pil.convert("RGB")).unsqueeze(0).to(DEVICE)
    out       = models["reltr"](img_t)

    sub_prob = out["sub_logits"].softmax(-1)[0]
    obj_prob = out["obj_logits"].softmax(-1)[0]
    rel_prob = out["rel_logits"].softmax(-1)[0]

    sub_scores, sub_ids = sub_prob[:, :-1].max(-1)
    obj_scores, obj_ids = obj_prob[:, :-1].max(-1)
    rel_scores, rel_ids = rel_prob[:, :-1].max(-1)

    combined    = (sub_scores * obj_scores * rel_scores) ** (1/3)
    k           = min(RELTR_TOPK, combined.numel())
    scores, idxs = combined.topk(k)

    classes = models["reltr_classes"]
    preds   = models["reltr_predicates"]
    rels    = []

    for s, qi in zip(scores.tolist(), idxs.tolist()):
        if s < RELTR_THR: continue
        sid = int(sub_ids[qi].item())
        oid = int(obj_ids[qi].item())
        rid = int(rel_ids[qi].item())
        subj = classes[sid] if sid < len(classes) else "N/A"
        obj  = classes[oid] if oid < len(classes) else "N/A"
        pred = preds[rid]   if rid < len(preds)   else "N/A"
        # Filter N/A and empty strings — same as Colab
        if "N/A" in (subj, pred, obj) or not all([subj, pred, obj]):
            continue
        rels.append({"subject":subj,"predicate":pred,"object":obj,
                     "score":round(float(s),3),"query_id":qi})
    return rels

# ─────────────────────────────────────────────────────────────────────────────
# FRAME SHARPNESS PICKER
# ─────────────────────────────────────────────────────────────────────────────

def _score_frame(f):
    try:
        img  = f if isinstance(f, Image.Image) else Image.fromarray(f)
        arr  = np.array(img.convert("RGB"))
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        return img, cv2.Laplacian(gray, cv2.CV_64F).var()
    except:
        return None, -1

def pick_sharp_frames(frames, threshold_ratio=0.6, max_frames=2):
    with ThreadPoolExecutor() as executor:
        results = list(executor.map(_score_frame, frames))
    results = [(img, score) for img, score in results if img is not None]
    if not results: return None, []
    results.sort(key=lambda x: x[1], reverse=True)
    best_frame = results[0][0]
    cutoff     = results[0][1] * threshold_ratio
    sharp      = [img for img, score in results if score >= cutoff][:max_frames]
    return best_frame, sharp

# ─────────────────────────────────────────────────────────────────────────────
# BUILD SCENE JSON — same as Colab build_scene_json
# ─────────────────────────────────────────────────────────────────────────────

def build_scene_json(img_pil, yolo_dets, depth_map, reltr_rels=None, max_objects=20):
    W, H  = img_pil.size
    dets  = _deduplicate(yolo_dets)
    dets  = sorted(dets, key=lambda d: d["conf"], reverse=True)[:max_objects]

    objects = []
    obj_id  = 0
    for d in dets:
        box = d["box_xyxy"]
        x1, y1, x2, y2 = box
        if x2 <= x1 or y2 <= y1: continue
        cx, cy      = (x1+x2)/2, (y1+y2)/2
        vert, horiz = _pos_label(cx, cy, W, H)
        depth_score = _depth_score(depth_map, box, W, H)
        mapped      = _map_label(d["label"])
        objects.append({
            "id":           obj_id,
            "label":        mapped,
            "yolo_label":   d["label"],
            "confidence":   round(float(d["conf"]), 3),
            "bbox_xyxy":    [round(float(v), 1) for v in box],
            "position":     f"{vert}-{horiz}",
            "distance":     _depth_label(depth_score),
            "depth_score":  round(float(depth_score), 3),
        })
        obj_id += 1

    return {
        "image":         {"width": W, "height": H},
        "objects":       objects,
        "relationships": reltr_rels or [],
        "meta":          {"created_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    }

# ─────────────────────────────────────────────────────────────────────────────
# LOCATION DETECTION
# ─────────────────────────────────────────────────────────────────────────────

LOCATIONS = {
    "living room": ["couch","tv","remote","potted plant","book","clock","laptop","vase","chair","airconditioner","curtains","switch","window","door","cabinet"],
    "kitchen":     ["refrigerator","microwave","oven","toaster","sink","cup","bottle","bowl","fork","knife","spoon","wine glass","dining table","coffeemachine","kettle","dishwasher","plate","trashbin","cabinet","drawer"],
    "bedroom":     ["bed","clock","laptop","cell phone","book","wardrobe","nightstand","curtains","mirror","airconditioner","hairbrush","drawer","switch","window","door","towel"],
    "bathroom":    ["toothbrush","sink","toilet","scissors","mirror","towel","soapdispenser","tissuebox","trashbin","washingmachine","window","door","switch"],
    "hallway":     ["umbrella","handbag","backpack","bicycle","hallway","door","mirror","shoe","keys","stairs","switch","window","trashbin"],
    "cafe":        ["cup","chair","dining table","bottle","wine glass","bowl","spoon","coffeemachine","kettle","menu","tissuebox","trashbin","window"],
    "restaurant":  ["dining table","chair","fork","knife","spoon","cup","wine glass","bottle","bowl","menu","plate","trashbin","tissuebox","window","door"],
    "stairs area": ["stairs","door","switch","window","trashbin","hallway"],
    "classroom":   ["chair","laptop","book","clock","cell phone","keyboard","mouse","table","window","door","switch","airconditioner","cabinet","powersocket"],
}

def _detect_location(detected_labels):
    best_loc, best_score = None, 0
    for loc, keywords in LOCATIONS.items():
        matches = sum(1 for k in keywords if k.lower() in detected_labels)
        score   = matches / len(keywords)
        if score > best_score:
            best_score = score
            best_loc   = loc
    if best_loc:
        total = sum(1 for k in LOCATIONS[best_loc] if k.lower() in detected_labels)
        if total < 2: best_loc = None
    return best_loc

# ─────────────────────────────────────────────────────────────────────────────
# MAIN DESCRIBE FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def run_describe(frames, models):
    best_frame, sharp_frames = pick_sharp_frames(frames)
    if best_frame is None:
        return "Could not process the image."

    W, H = best_frame.size

    # 1) YOLO on all sharp frames merged
    all_dets = []
    for frame in sharp_frames:
        frame_arr = np.array(frame.convert("RGB"))
        all_dets.extend(run_yolo(frame_arr, models))

    # 2) MiDaS on best frame
    depth = run_midas(best_frame, models)

    # 3) RelTR on best frame
    if len(all_dets) < 2:
        rels = []
    else:
        rels = run_reltr(best_frame, models)
        print(f"[RelTR] raw rels: {len(rels)}")
        for r in rels[:5]:
            print(f"  {r['subject']} — {r['predicate']} — {r['object']} (score={r['score']})")
        rels = _filter_rels(rels, all_dets)
        print(f"[RelTR] after filter: {len(rels)}")
        print(f"[YOLO] dets: {[d['label'] for d in all_dets]}")

    # 4) Build rich scene JSON — same as Colab
    scene = build_scene_json(best_frame, all_dets, depth, rels)

    # 5) Clean relationships for LLM — same as Colab scene_for_llm
    scene_for_llm = dict(scene)
    scene_for_llm["relationships"] = _clean_rels(rels, max_rels=12)

    # 6) Location detection
    detected_labels = set(o["label"].lower() for o in scene["objects"])
    best_location   = _detect_location(detected_labels)
    location_hint   = f"You seem to be in a {best_location}." if best_location else "You seem to be in a room."

    # 7) LLM — same prompt as Colab describe_scene
    resp = models["groq"].chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": f"""You are a helpful assistant for blind and visually impaired people.

A blind person has just asked you: "Can you describe the scene around me?"

Using the scene data below, respond directly to them in 4-6 sentences.
Start your response with exactly: "{location_hint} "
Describe what surrounds them — what objects are nearby, where they are positioned,
how far or close things seem, and anything they should be aware of for safety or navigation.
Be warm, clear, and detailed enough that they can form a mental picture of their environment.
Do not mention confidence scores, bounding boxes, or any technical detection data.
Do not repeat the same object twice.
Speak directly using "you" and "your".

Scene data:
{json.dumps(scene_for_llm, indent=2)}

Now respond to them:"""}])
    return resp.choices[0].message.content