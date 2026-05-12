import os

BASE_DIR   = "/workspace/echovision"
MODELS_DIR = BASE_DIR + "/models"
RELTR_REPO = MODELS_DIR + "/RelTR"
RELTR_CKPT = MODELS_DIR + "/RelTR/ckpt/checkpoint0149.pth"
VG_ANN_DIR = MODELS_DIR + "/data/vg"
CUSTOM_YOLO = MODELS_DIR + "/yolo_custom_best.pt"
RESNET_W   = MODELS_DIR + "/resnet18_rafdb.pth"
DEVICE     = "cuda"

GROQ_API_KEY       = os.environ.get("GROQ_API_KEY", "")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
PINECONE_API_KEY   = os.environ.get("PINECONE_API_KEY", "")

CONF_THRESHOLD = 0.40
IOU_THRESHOLD  = 0.50
RELTR_THR      = 0.30
RELTR_TOPK     = 10
MAX_OBJECTS    = 20
MAX_RELS       = 12

EMOTION_LABELS   = ["surprise", "fear", "disgust", "happy", "sad", "angry", "neutral"]
ARC_EMBED_DIM    = 512
COSINE_THRESHOLD = 0.50
PINECONE_INDEX   = "face-embeddings"

SCAN_MAX_RETRIES      = 3
STICKER_MAX_RETRIES   = 4
WALK_TIMEOUT_SECONDS  = 30
WALK_HINT_INTERVAL    = 10.0
REPEAT_INTERVAL       = 15.0

SUPPORTED_COLORS = {"red", "blue", "green", "yellow", "orange", "purple", "pink", "white", "black"}
SUPPORTED_SHAPES = {"circle", "square", "rectangle", "triangle"}

SURFACE_PRIORITY     = ["table", "chair", "sofa", "nightstand","bed", "bench"]
SURFACE_CLASSES_LOWER = {"bench", "chair", "table", "nightstand", "sofa", "bed"}
OBSTACLE_CLASSES_LOWER = {
    # COCO classes
    "person", "dog", "cat", "chair", "couch", "sofa", "bed", "bench",
    "potted plant" "backpack", "handbag", "suitcase",
    "tv", "laptop", "bottle", "umbrella",
    # Custom model classes — all lowercase (labels normalized in _yolo_dets)
    "trashbin", "shoe", "door", "stairs", "cabinet", "wardrobe",
    "washingmachine", "dishwasher", "table", "drawer",
}

RELTR_SYNONYMS = {
    "backpack": "bag", "cell phone": "phone", "couch": "seat",
    "dining table": "table", "handbag": "bag", "potted plant": "plant",
    "tv": "screen", "curtains": "curtain"
}
PERSON_ALIASES = {"man", "woman", "boy", "girl", "child", "kid", "lady", "guy", "people", "player", "skier", "men"}
DRINK_ALIASES  = {"glass", "mug", "drink"}
TABLE_ALIASES  = {"desk", "counter"}

# ─────────────────────────────────────────────────────────────────────────────
# STICKER COLOR PROFILES  (HSV ranges)
# Each color maps to a list of (lower, upper) HSV pairs to handle wraparound.
# ─────────────────────────────────────────────────────────────────────────────

COLOR_PROFILES = {
    # Red wraps around 0° in HSV — needs two ranges
    # Wide ranges to catch dark red, bright red, pinkish red
    "red": [
        ([0,   60,  50], [15,  255, 255]),
        ([160, 60,  50], [180, 255, 255]),
    ],
    "blue": [
        ([100, 120,  70], [130, 255, 255]),
    ],
    "green": [
        ([40,  70,   70], [80,  255, 255]),
    ],
    "yellow": [
        ([20,  120,  70], [35,  255, 255]),
    ],
    "orange": [
        ([10,  150,  70], [20,  255, 255]),
    ],
    "purple": [
        ([130, 60,   70], [160, 255, 255]),
    ],
    "pink": [
        ([160, 60,   70], [170, 255, 255]),
    ],
    "white": [
        ([0,   0,   200], [180, 40,  255]),
    ],
    "black": [
        ([0,   0,     0], [180, 255,  50]),
    ],
}