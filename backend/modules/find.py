import cv2, numpy as np, time
from PIL import Image
import sys
sys.path.insert(0, "/workspace/echovision")
from core.config import *
from core.firebase import get_sticker_table, get_items_table
from modules.identify import db_lookup, db_save
from modules.describe import run_midas, _depth_score, _depth_label, _pos_label, _map_label

# ─────────────────────────────────────────────────────────────────────────────
# YOLO HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _yolo_dets(model, frame_bgr, conf):
    result = model(frame_bgr, conf=conf, verbose=False)[0]
    dets   = []
    for box in result.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        label = model.names[int(box.cls[0])]
        c     = float(box.conf[0])
        dets.append({"label": label.lower(), "conf": c, "box_xyxy": [x1, y1, x2, y2]})
    return dets

def run_yolo_both(frame_bgr, models, conf=0.15):
    custom = _yolo_dets(models["custom_yolo"], frame_bgr, conf)
    coco   = _yolo_dets(models["coco_yolo"],   frame_bgr, conf)
    custom_labels = {d["label"].lower() for d in custom}
    merged = list(custom)
    for d in coco:
        if d["label"].lower() not in custom_labels:
            merged.append(d)
    return merged

# ─────────────────────────────────────────────────────────────────────────────
# STICKER HELPERS
# ─────────────────────────────────────────────────────────────────────────────

_cached_sticker_profile = None

def get_sticker_profile(user_id="shared"):
    records = [doc.to_dict() for doc in get_sticker_table(user_id).stream()]
    return records[0] if records else None

def _get_sticker_profile_cached(user_id="shared"):
    global _cached_sticker_profile
    if _cached_sticker_profile is None:
        _cached_sticker_profile = get_sticker_profile(user_id)
    return _cached_sticker_profile

def invalidate_sticker_cache():
    global _cached_sticker_profile
    _cached_sticker_profile = None

def setup_sticker(color, shape, user_id="shared"):
    color, shape = color.lower().strip(), shape.lower().strip()
    if color not in SUPPORTED_COLORS:
        return f"Unsupported color: {color}."
    if shape not in SUPPORTED_SHAPES:
        return f"Unsupported shape: {shape}."
    profile = {"color": color, "shape": shape}
    table   = get_sticker_table(user_id)
    for doc in table.stream():
        doc.reference.delete()
    table.add(profile)
    invalidate_sticker_cache()
    return profile

def _get_color_mask(hsv, color):
    ranges = COLOR_PROFILES[color]
    mask   = cv2.inRange(hsv, np.array(ranges[0][0]), np.array(ranges[0][1]))
    for lower, upper in ranges[1:]:
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv, np.array(lower), np.array(upper)))
    return mask

def _detect_shape(mask, shape):
    kernel   = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask     = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask     = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)
    h, w     = mask.shape
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if not (400 <= area <= 80000):
            continue
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            continue
        cx_c = int(M["m10"] / M["m00"])
        cy_c = int(M["m01"] / M["m00"])
        if not (w * 0.02 <= cx_c <= w * 0.98 and h * 0.02 <= cy_c <= h * 0.98):
            continue
        peri = cv2.arcLength(cnt, True)
        if peri == 0:
            continue
        circularity = 4 * np.pi * area / (peri * peri)
        bw, bh  = cv2.boundingRect(cnt)[2:]
        aspect  = bw / float(bh) if bh > 0 else 0
        corners = len(cv2.approxPolyDP(cnt, 0.04 * peri, True))
        if shape == "circle"    and circularity >= 0.55 and 0.5 <= aspect <= 1.6:  return True
        if shape == "triangle"  and corners == 3:                                   return True
        if shape == "square"    and corners <= 5 and 0.65 <= aspect <= 1.35:        return True
        if shape == "rectangle" and corners <= 6 and aspect >= 0.2:                 return True
    return False

def validate_sticker(frame_bgr):
    profile = _get_sticker_profile_cached()
    if profile is None:
        return False
    h, w = frame_bgr.shape[:2]
    cx1, cy1 = int(w * 0.20), int(h * 0.20)
    cx2, cy2 = int(w * 0.80), int(h * 0.80)
    roi  = frame_bgr[cy1:cy2, cx1:cx2]
    hsv  = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    mask = _get_color_mask(hsv, profile["color"])
    return _detect_shape(mask, profile["shape"])

# ─────────────────────────────────────────────────────────────────────────────
# STICKER MULTI-FRAME COLLECTION
# ─────────────────────────────────────────────────────────────────────────────

_sticker_frames_collected  = []
_sticker_collection_active = False
_STICKER_TOTAL_FRAMES      = 5
_STICKER_MIN_CONFIRMS      = 2

def reset_sticker_collection():
    global _sticker_frames_collected, _sticker_collection_active
    _sticker_frames_collected  = []
    _sticker_collection_active = False

def start_sticker_collection():
    global _sticker_frames_collected, _sticker_collection_active
    _sticker_frames_collected  = []
    _sticker_collection_active = True

def add_sticker_frame(frame_bgr):
    global _sticker_frames_collected, _sticker_collection_active
    if not _sticker_collection_active:
        return "idle"
    frame_cv = (cv2.cvtColor(np.array(frame_bgr), cv2.COLOR_RGB2BGR)
                if not isinstance(frame_bgr, np.ndarray) else frame_bgr)
    hit = validate_sticker(frame_cv)
    _sticker_frames_collected.append(hit)
    collected = len(_sticker_frames_collected)
    confirms  = sum(_sticker_frames_collected)
    print(f"[Sticker] frame {collected}/{_STICKER_TOTAL_FRAMES} — detected={hit}, confirms={confirms}/{_STICKER_MIN_CONFIRMS}")
    if confirms >= _STICKER_MIN_CONFIRMS:
        reset_sticker_collection()
        return "confirmed"
    if collected >= _STICKER_TOTAL_FRAMES:
        reset_sticker_collection()
        return "not_found"
    return "collecting"

# ─────────────────────────────────────────────────────────────────────────────
# SURFACE HELPER
# ─────────────────────────────────────────────────────────────────────────────

def _find_surface(matched_box, all_dets, frame_h=None):
    x1, y1, x2, y2 = matched_box
    item_cx   = (x1 + x2) / 2
    tolerance = (frame_h * 0.10) if frame_h else 30
    candidates = []
    for d in all_dets:
        if d["label"].lower() not in SURFACE_CLASSES_LOWER:
            continue
        sx1, sy1, sx2, sy2 = d["box_xyxy"]
        if (y2 >= sy1 - tolerance and y2 <= sy2 + tolerance
                and (sx1 <= item_cx <= sx2 or not (x2 < sx1 or x1 > sx2))):
            candidates.append(d["label"].lower())
    if not candidates:
        return None
    for preferred in SURFACE_PRIORITY:
        if preferred in candidates:
            return f"on the {preferred}"
    return f"on the {candidates[0]}"

# ─────────────────────────────────────────────────────────────────────────────
# OBSTACLE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _which_side_clearer(dets, W):
    mid         = W / 2
    left_count  = sum(1 for d in dets
                      if d["label"].lower() in OBSTACLE_CLASSES_LOWER
                      and (d["box_xyxy"][0] + d["box_xyxy"][2]) / 2 < mid)
    right_count = sum(1 for d in dets
                      if d["label"].lower() in OBSTACLE_CLASSES_LOWER
                      and (d["box_xyxy"][0] + d["box_xyxy"][2]) / 2 >= mid)
    return "left" if right_count > left_count else "right"

def _overlap(a, b, thr=0.4):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0: return False
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union  = area_a + area_b - inter
    return (inter / union) >= thr if union > 0 else False

# ─────────────────────────────────────────────────────────────────────────────
# CANDIDATE DETECTION — finds all instances of item in frames
# sorted by depth score (nearest first)
# ─────────────────────────────────────────────────────────────────────────────

def _find_all_candidates(item_name, frames_bgr, models, excluded_boxes=None):
    """
    Run YOLO on all frames, find all instances of item_name.
    Returns list of candidates sorted nearest first.
    Excluded boxes (already-tried wrong items) are filtered out.
    """
    if isinstance(frames_bgr, np.ndarray):
        frames_bgr = [frames_bgr]

    item_name_lower = item_name.lower()
    all_dets = []
    for frame in frames_bgr:
        all_dets.extend(run_yolo_both(frame, models, conf=0.15))

    # filter for matching item label
    matches = [d for d in all_dets if
               _map_label(d["label"]) == item_name_lower or
               d["label"].lower() == item_name_lower]

    # filter out excluded boxes (already tried)
    if excluded_boxes:
        matches = [d for d in matches
                   if not any(_overlap(d["box_xyxy"], ex) for ex in excluded_boxes)]

    if not matches:
        return [], []

    # run MiDaS on first frame for depth
    img_pil   = Image.fromarray(cv2.cvtColor(frames_bgr[0], cv2.COLOR_BGR2RGB))
    depth_map = run_midas(img_pil, models)
    W, H      = img_pil.size

    candidates = []
    for d in matches:
        x1, y1, x2, y2 = d["box_xyxy"]
        ds          = _depth_score(depth_map, d["box_xyxy"], W, H)
        vert, horiz = _pos_label((x1 + x2) / 2, (y1 + y2) / 2, W, H)
        surface     = _find_surface(d["box_xyxy"], all_dets, frame_h=H)
        horiz_str   = {"left": "to your left", "center": "ahead of you", "right": "to your right"}.get(horiz, "ahead of you")
        location_hint = f"{surface}, {horiz_str}" if surface else horiz_str
        candidates.append({
            "label":         d["label"],
            "conf":          d.get("conf", 0),
            "box_xyxy":      d["box_xyxy"],
            "location_hint": location_hint,
            "depth_score":   ds,
        })

    # sort nearest first (highest depth_score = nearest)
    candidates.sort(key=lambda c: c["depth_score"], reverse=True)
    return candidates, all_dets

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — ROOM SCAN
# ─────────────────────────────────────────────────────────────────────────────

def run_find_scan(item_name, frames_bgr, models, scan_attempt=1, user_id="shared", excluded_boxes=None):
    if not item_name or not item_name.strip():
        return {"status": "error", "message": "Item name is missing. Please try again."}

    record = db_lookup(item_name, user_id)
    if record is None:
        return {
            "status":  "not_registered",
            "message": (f"Your {item_name} has not been registered. "
                        f"Please say identify my {item_name} followed by the room name first."),
        }

    profile = _get_sticker_profile_cached(user_id)
    if profile is None:
        return {
            "status":  "no_sticker",
            "message": "No sticker profile found. Please set up your sticker first.",
        }

    if scan_attempt > 3:
        return {
            "status":  "give_up",
            "message": (f"I was unable to find your {item_name} after 3 attempts. "
                        f"It may have been moved. Please say identify my {item_name} to register its new location."),
        }

    if scan_attempt == 0:
        return {"status": "registered", "message": f"Your {item_name} is registered. Starting scan."}

    if scan_attempt == 2:
        guidance = "Scan 2 of 3. Try raising the camera slightly and scan left to right slowly. "
    elif scan_attempt == 3:
        guidance = "Last scan. Please turn around slowly and keep the camera steady. "
    else:
        guidance = ""

    if isinstance(frames_bgr, np.ndarray):
        frames_bgr = [frames_bgr]
    if not frames_bgr:
        return {"status": "not_found", "message": "No frames received.", "scan_attempt": scan_attempt}

    candidates, all_dets = _find_all_candidates(item_name, frames_bgr, models, excluded_boxes)

    if not candidates:
        return {
            "status":       "not_found",
            "message":      (f"{guidance}I could not find your {item_name}. "
                             f"Move the camera slowly from left to right."),
            "scan_attempt": scan_attempt,
        }

    count = len(candidates)
    best  = candidates[0]

    if count == 1:
        message = (f"I found one {item_name} {best['location_hint']}. "
                   f"I will guide you to it.")
    else:
        message = (f"I found {count} {item_name}s in the room. "
                   f"Navigating you to the nearest one.")

    return {
        "status":       "found",
        "message":      message,
        "matches":      candidates[:3],
        "all_count":    count,
        "record":       record,
        "scan_attempt": scan_attempt,
    }

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2A — OBSTACLE CHECK  (called every 800ms)
# ─────────────────────────────────────────────────────────────────────────────

_last_obstacle_label     = None
_last_obstacle_warn_time = 0.0

def run_obstacle_check(frame_bgr, target_box, excluded_boxes, models, item_name=None):
    global _last_obstacle_label, _last_obstacle_warn_time

    dets = run_yolo_both(frame_bgr, models, conf=0.35)
    H, W = frame_bgr.shape[:2]

    item_labels = set()
    if item_name:
        item_labels.add(item_name.lower())
        item_labels.add(_map_label(item_name.lower()))

    center_left  = W * 0.25
    center_right = W * 0.75
    closest      = None
    closest_ratio = 0.0

    for d in dets:
        if d["label"].lower() not in OBSTACLE_CLASSES_LOWER:           continue
        if d["label"].lower() in item_labels:                          continue
        if _map_label(d["label"]) in item_labels:                      continue
        box = d["box_xyxy"]
        if target_box and _overlap(box, target_box):                   continue
        if any(_overlap(box, ex) for ex in (excluded_boxes or [])):    continue
        x1, y1, x2, y2 = box
        cx = (x1 + x2) / 2
        if not (center_left <= cx <= center_right):                    continue
        ratio = (y2 - y1) / H
        if ratio < 0.20:                                               continue
        if ratio > closest_ratio:
            closest_ratio = ratio
            closest       = {"label": d["label"], "ratio": ratio}

    if not closest:
        return None

    label = closest["label"]
    ratio = closest["ratio"]
    now   = time.time()

    same     = (label.lower() == (_last_obstacle_label or "").lower())
    too_soon = (now - _last_obstacle_warn_time) < 4.0
    if same and too_soon:
        return None

    _last_obstacle_label     = label
    _last_obstacle_warn_time = now
    side = _which_side_clearer(dets, W)

    if ratio >= 0.55:
        return f"Stop. {label.capitalize()} right in front of you. Move to the {side}."
    else:
        return f"{label.capitalize()} ahead. Move to the {side}."

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2B — WALK FRAME  (called every 1500ms)
# ─────────────────────────────────────────────────────────────────────────────

_last_direction = None
_item_reached   = False

def run_find_walk_frame(item_name, frame_bgr, target_box, excluded_boxes, models):
    global _last_direction, _last_obstacle_warn_time, _item_reached

    img_pil   = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    dets      = run_yolo_both(frame_bgr, models, conf=0.25)
    depth_map = run_midas(img_pil, models)
    W, H      = img_pil.size

    item_name_lower = item_name.lower()
    print(f"[Walk] all detections: {[(d['label'], round(d['conf'],2)) for d in dets]}")

    candidates = [
        d for d in dets
        if (_map_label(d["label"]) == item_name_lower or d["label"].lower() == item_name_lower)
        and not any(_overlap(d["box_xyxy"], ex) for ex in (excluded_boxes or []))
    ]
    print(f"[Walk] candidates for '{item_name}': {[(d['label'], round(d['conf'],2)) for d in candidates]}")

    # pick closest to last known target box
    if len(candidates) > 1 and target_box is not None:
        def _dist(box):
            cx = (box[0] + box[2]) / 2; cy = (box[1] + box[3]) / 2
            tx = (target_box[0] + target_box[2]) / 2; ty = (target_box[1] + target_box[3]) / 2
            return (cx - tx) ** 2 + (cy - ty) ** 2
        candidates = sorted(candidates, key=lambda d: _dist(d["box_xyxy"]))

    if candidates:
        d   = candidates[0]
        box = d["box_xyxy"]
        x1, y1, x2, y2 = box
        vert, horiz = _pos_label((x1 + x2) / 2, (y1 + y2) / 2, W, H)
        ds          = _depth_score(depth_map, box, W, H)
        dl          = _depth_label(ds)

        box_height_ratio = (y2 - y1) / H
        is_near = (dl == "near") or (box_height_ratio >= 0.28)

        if is_near and not _item_reached:
            _item_reached   = True
            _last_direction = None
            reset_sticker_collection()
            start_sticker_collection()
            return {
                "status":         "reached",
                "message":        f"Stop. Your {item_name} is right in front of you. Hold it up to the camera for validation.",
                "obstacle":       None,
                "new_target_box": box,
            }

        horiz_str = {
            "left":   "move right",
            "center": "go straight",
            "right":  "move left",
        }.get(horiz, "go straight")

        vert_str = {
            "top":    ", it is still far ahead",
            "middle": "",
            "bottom": ", you are almost there",
        }.get(vert, "")

        hint = f"{horiz_str}{vert_str}"

        now               = time.time()
        obstacle_pause    = (now - _last_obstacle_warn_time) < 2.0
        direction_changed = (horiz != _last_direction)

        item_message = None
        if direction_changed and not obstacle_pause:
            item_message    = hint
            _last_direction = horiz

        return {
            "status":         "walking",
            "message":        item_message,
            "obstacle":       None,
            "new_target_box": box,
        }

    # item not visible — do NOT rescan, just say lost
    _item_reached = False
    return {
        "status":         "lost",
        "message":        f"Still searching for your {item_name}. Move the camera slowly.",
        "obstacle":       None,
        "new_target_box": target_box,
    }

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — STICKER VALIDATION
# If sticker not confirmed → trigger rescan for next candidate
# ─────────────────────────────────────────────────────────────────────────────

def run_sticker_validate(frame_bgr, item_name="item"):
    result = add_sticker_frame(frame_bgr)

    if result == "idle" or result == "collecting":
        return {
            "confirmed": False,
            "message":   None,
            "status":    "collecting",
            "progress":  len(_sticker_frames_collected),
        }
    elif result == "confirmed":
        _item_reached_reset()
        return {
            "confirmed": True,
            "message":   f"Confirmed. This is your {item_name}.",
            "status":    "confirmed",
        }
    else:
        # sticker not found on this item — signal app to rescan for next candidate
        _item_reached_reset()
        return {
            "confirmed": False,
            "message":   f"This does not seem to be your {item_name}. Let me look for another one.",
            "status":    "try_next",  # ← new status — app triggers rescan
        }

def _item_reached_reset():
    global _item_reached, _last_direction
    _item_reached   = False
    _last_direction = None