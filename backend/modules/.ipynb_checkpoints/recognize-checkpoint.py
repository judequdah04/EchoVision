import cv2, torch, numpy as np
from PIL import Image
from torchvision import transforms
import sys
sys.path.insert(0, "/workspace/echovision")
from core.config import *

def predict_emotion(model, face_bgr):
    transform = transforms.Compose([
        transforms.Resize((224,224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
    ])
    img = Image.fromarray(cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB))
    tensor = transform(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        probs = torch.softmax(model(tensor), dim=1)[0]
        idx = probs.argmax().item()
    return EMOTION_LABELS[idx], float(probs[idx])

def get_depth_map(midas, transform, img_bgr):
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    inp = transform(img_rgb).to(DEVICE)
    with torch.no_grad():
        pred = midas(inp)
        pred = torch.nn.functional.interpolate(
            pred.unsqueeze(1), size=img_bgr.shape[:2],
            mode="bicubic", align_corners=False).squeeze()
    depth = pred.cpu().numpy()
    d_min, d_max = depth.min(), depth.max()
    if d_max - d_min > 0:
        depth = (depth - d_min) / (d_max - d_min)
    return depth

def estimate_distance(depth_map, bbox):
    x1,y1,x2,y2 = [int(v) for v in bbox]
    h,w = depth_map.shape
    crop = depth_map[max(0,y1):min(h,y2), max(0,x1):min(w,x2)]
    if crop.size == 0: return "at an unknown distance"
    median = float(np.median(crop))
    if median > 0.65: return "close to you"
    elif median > 0.35: return "a few steps away"
    else: return "far from you"

def estimate_position(bbox, frame_width):
    cx = (bbox[0] + bbox[2]) / 2
    third = frame_width / 3
    if cx < third: return "to your left"
    elif cx < 2*third: return "in front of you"
    else: return "to your right"

def identify_face(embedding, pinecone_index, user_id="shared"):
    try:
        # Use Pinecone namespace to scope faces per user
        stats = pinecone_index.describe_index_stats()
        ns_stats = stats.namespaces.get(user_id, None)
        count = ns_stats.vector_count if ns_stats else 0
    except:
        count = 0
    if count == 0: return "Unknown", 0.0
    query = (embedding / np.linalg.norm(embedding)).astype(np.float32).tolist()
    results = pinecone_index.query(
        vector=query,
        top_k=1,
        include_metadata=True,
        namespace=user_id   # ← scoped to this user only
    )
    if not results.matches: return "Unknown", 0.0
    match = results.matches[0]
    score = float(match.score)
    if score >= COSINE_THRESHOLD:
        return match.metadata.get("name", match.id), score
    return "Unknown", score

def build_sentence(results):
    if not results: return "No faces detected in front of you."
    if len(results) == 1:
        r = results[0]
        name = "Someone unknown" if r["name"] == "Unknown" else r["name"]
        return f"{name} is {r['position']}, {r['distance']}, and seems {r['emotion']}."
    parts = []
    for r in results:
        name = "An unknown person" if r["name"] == "Unknown" else r["name"]
        parts.append(f"{name} is {r['position']}, {r['distance']}, and seems {r['emotion']}.")
    return " ".join(parts)

def pick_best_frame(frames):
    import cv2 as _cv2
    best, best_score = None, -1
    for f in frames:
        try:
            img = f if isinstance(f, np.ndarray) else np.array(f)
            gray = _cv2.cvtColor(img, _cv2.COLOR_RGB2GRAY) if len(img.shape)==3 else img
            score = _cv2.Laplacian(gray, _cv2.CV_64F).var()
            if score > best_score:
                best_score = score
                best = img
        except: pass
    return best

def run_recognize(frames, models, user_id="shared"):
    img_arr = pick_best_frame(frames)
    if img_arr is None: return "Could not process the image."
    img_bgr = cv2.cvtColor(img_arr, cv2.COLOR_RGB2BGR)
    frame_h, frame_w = img_bgr.shape[:2]
    faces = models["face_app"].get(img_bgr)
    if not faces: return "No faces detected in front of you."
    faces = [f for f in faces if f.det_score >= 0.75]
    if not faces: return "No faces detected with sufficient confidence."
    depth_map = get_depth_map(models["midas"], models["midas_transform"], img_bgr)
    results = []
    for face in faces:
        bbox = face.bbox
        x1,y1,x2,y2 = [int(v) for v in bbox]
        x1,y1 = max(0,x1),max(0,y1)
        x2,y2 = min(frame_w,x2),min(frame_h,y2)
        face_crop = img_bgr[y1:y2, x1:x2]
        name, score = identify_face(face.normed_embedding, models["pinecone"], user_id)
        emotion, emo_conf = predict_emotion(models["sentiment"], face_crop) if face_crop.size > 0 else ("neutral", 0.0)
        position = estimate_position(bbox, frame_w)
        distance = estimate_distance(depth_map, bbox)
        results.append({"name":name,"score":score,"emotion":emotion,
                        "emo_conf":emo_conf,"position":position,"distance":distance})
    results.sort(key=lambda r: r["name"] == "Unknown")
    return build_sentence(results)
