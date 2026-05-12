import sys, os, re, tempfile, subprocess, base64
sys.path.insert(0, "/workspace/echovision")
from core.config import ELEVENLABS_API_KEY, GROQ_API_KEY
from elevenlabs.client import ElevenLabs

_eleven = ElevenLabs(api_key=ELEVENLABS_API_KEY)

MIN_WORDS = 2
FILLER_WORDS = {
    "um","uh","ah","oh","hmm","hm","eh","the","a","an","and","or","but","so",
    "like","you","know","i","just","okay","ok","mm","mmm","mhm","huh","yeah",
    "yep","nope","no","yes","trails","off"
}

NOISE_WORDS = {
    "um","uh","ah","oh","hmm","hm","eh","mm","mmm","mhm","huh",
    "please","like","just","sort","kind","of","thing","stuff","it",
    "that","this","there","here","some","the","a","an","my","your",
    "maybe","probably","actually","basically","literally","right",
    "so","well","now","then","also","too","very","really","okay","ok",
}

# words that should never appear in an object name
# catches trailing noise like "tomorrow", "later", "please", "now"
INVALID_OBJECT_WORDS = {
    "tomorrow","yesterday","today","later","soon","now","please","thanks",
    "thank","okay","ok","sure","right","well","then","again","already",
    "always","never","maybe","probably","perhaps","actually","basically",
    "literally","really","very","also","too","much","more","less",
    "good","bad","new","old","big","small","large","little","long","short",
    "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
    "morning","afternoon","evening","night","week","month","year",
    "go","come","take","put","get","give","make","do","say","tell",
    "know","think","see","look","find","want","need","use",
}

# valid room/location words — only these are accepted as locations
VALID_LOCATION_WORDS = {
    "kitchen","bedroom","bathroom","living","room","hallway","office",
    "garage","basement","attic","dining","study","library","balcony",
    "garden","yard","porch","entrance","lobby","corridor","pantry",
    "laundry","closet","wardrobe","shelf","drawer","table","desk",
    "counter","floor","bed","sofa","couch","chair","cabinet","cupboard",
    "fridge","refrigerator","oven","microwave","sink","toilet","shower",
    "window","door","wall","corner","left","right","front","back",
}

DOMAIN_KEYWORDS = ["describe","recognize","identify","find","where"]
STOP_KEYWORDS   = ["stop","quit"]


def has_vowels(word):
    return bool(re.search(r'[aeiou]', word.lower()))


def validate_transcript(text):
    lowered = text.lower().strip()
    if lowered in ["stop","quit"]: return "stop"
    if not text or text.strip() == "": return "invalid"
    if re.search(r'[^\x00-\x7F]', text): return "invalid"
    stripped = re.sub(r'[^\w\s]', '', text).strip()
    if not stripped: return "invalid"
    if re.fullmatch(r'[\d\s]+', stripped): return "invalid"
    words = stripped.lower().split()
    if len(words) < MIN_WORDS: return "invalid"
    meaningful = [w for w in words if w not in FILLER_WORDS]
    if len(meaningful) == 0: return "invalid"
    if len(set(words)) == 1: return "invalid"
    return "valid"


def _clean_text(text):
    text = text.lower().strip()
    text = text.replace("it's","it is").replace("where's","where is")
    text = text.replace("what's","what is").replace("there's","there is")
    leading = [
        "can you please","could you please","please can you","could you",
        "can you","please","hey suji","suji","i want you to","i need you to",
        "i would like you to","i want to","tell me","show me","help me",
    ]
    for f in leading:
        if text.startswith(f): text = text[len(f):].strip()
    text = text.rstrip(".,!?;:")
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _remove_duplicate_keywords(text):
    """
    Remove duplicate domain keywords from the start of text.
    'identify identify my bag' -> 'identify my bag'
    'find find my wallet' -> 'find my wallet'
    """
    words = text.strip().split()
    if len(words) < 2:
        return text
    # remove consecutive duplicate keywords at start
    i = 1
    while i < len(words) and words[i].lower() == words[0].lower() and words[0].lower() in DOMAIN_KEYWORDS:
        i += 1
    return ' '.join(words[i-1:])  # keep one instance


def _dedupe_words(text):
    """
    Smart deduplication and denoising of extracted object/location text.
    - Consecutive duplicates: 'bottle bottle' -> 'bottle'
    - Repeated phrases: 'water bottle water bottle' -> 'water bottle'
    - Stutters: 'my my wallet' -> 'my wallet'
    - Filler insertions: 'the uh bottle' -> 'bottle'
    - Trailing noise: 'bottle please' -> 'bottle'
    - Trailing invalid words: 'bag tomorrow' -> 'bag'
    """
    if not text: return text
    text = text.strip().lower()
    text = re.sub(r'[^\w\s]', '', text).strip()
    words = text.split()

    # remove noise from start and end
    while words and words[0] in NOISE_WORDS:
        words = words[1:]
    while words and words[-1] in NOISE_WORDS:
        words = words[:-1]

    # remove trailing invalid object words (tomorrow, later, please, etc.)
    while words and words[-1] in INVALID_OBJECT_WORDS:
        words = words[:-1]

    if not words:
        return text

    # remove consecutive duplicate words
    deduped = [words[0]]
    for w in words[1:]:
        if w.lower() != deduped[-1].lower():
            deduped.append(w)

    # remove filler words sandwiched between real words
    cleaned = []
    for w in deduped:
        if w in NOISE_WORDS:
            if w in {"in","on","at","by","near","next","to","under","above","behind","front","left","right"}:
                cleaned.append(w)
        else:
            cleaned.append(w)

    # remove repeated phrases: 'water bottle water bottle' -> 'water bottle'
    result = cleaned[:]
    for length in range(len(cleaned)//2, 0, -1):
        phrase = [w.lower() for w in cleaned[:length]]
        rest   = [w.lower() for w in cleaned[length:length+length]]
        if phrase == rest:
            result = cleaned[:length]
            break

    # final cleanup
    while result and result[-1] in NOISE_WORDS:
        result = result[:-1]
    while result and result[0] in NOISE_WORDS:
        result = result[1:]
    while result and result[-1] in INVALID_OBJECT_WORDS:
        result = result[:-1]

    return ' '.join(result) if result else ''


def _validate_object(obj):
    """
    Validate that extracted object name is a real object and not noise.
    Returns cleaned object or None if invalid.
    """
    if not obj:
        return None

    words = obj.lower().split()

    # reject if all words are invalid/noise
    real_words = [w for w in words if w not in NOISE_WORDS and w not in INVALID_OBJECT_WORDS]
    if not real_words:
        return None

    # reject if only 1 char
    if len(obj.strip()) <= 1:
        return None

    # reject if it's just a number
    if re.fullmatch(r'[\d\s]+', obj):
        return None

    return ' '.join(real_words)


def _validate_location(loc):
    """
    Validate that extracted location contains at least one known location word.
    Returns location or None if it looks like noise.
    """
    if not loc:
        return None
    words = loc.lower().split()
    # at least one word must be a valid location word
    if any(w in VALID_LOCATION_WORDS for w in words):
        return loc
    return None


def _extract_location(text):
    """Extract location from text using common patterns."""
    patterns = [
        r'\bin my\s+(.+)$',
        r'\bin the\s+(.+)$',
        r'\bat the\s+(.+)$',
        r'\bat my\s+(.+)$',
        r'\bon the\s+(.+)$',
        r'\bon my\s+(.+)$',
        r'\bnear the\s+(.+)$',
        r'\bnext to the\s+(.+)$',
        r'\blocated in\s+(.+)$',
        r'\bplaced in\s+(.+)$',
        r'\binside the\s+(.+)$',
        r'\binside my\s+(.+)$',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            loc = m.group(1).strip().rstrip(".,!?;:")
            return _dedupe_words(loc), m.start()
    return None, len(text)


def parse_command(transcript):
    if not transcript or not transcript.strip(): return None
    text = _clean_text(transcript)

    # FIX 1: remove duplicate keywords before parsing
    # 'identify identify my bag' -> 'identify my bag'
    text = _remove_duplicate_keywords(text)

    for stop in STOP_KEYWORDS:
        if stop in text.split():
            return {"keyword":"stop","object":None,"location":None}

    found = [kw for kw in DOMAIN_KEYWORDS if kw in text.split()]
    if len(found) == 0: return None
    if len(found) > 1:
        # FIX 2: if multiple keywords found, use the first one only
        # handles 'identify where find bag' type noise
        found = [found[0]]

    keyword = found[0]
    detected_object = None
    detected_location = None

    if keyword in ["describe","recognize"]:
        return {"keyword":keyword,"object":None,"location":None}

    if keyword == "identify":
        cleaned = text
        for prefix in ["identify my","identify the","identify"]:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip(); break
        loc, loc_start = _extract_location(cleaned)
        if loc:
            detected_location = _validate_location(_dedupe_words(loc))
            cleaned = cleaned[:loc_start].strip()
        detected_object = _validate_object(_dedupe_words(cleaned.rstrip(".,!?;:").strip()))

    if keyword == "where":
        cleaned = text
        for prefix in ["where is my","where is the","where is","where's my","where's the","where's"]:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip(); break
        detected_object = _validate_object(_dedupe_words(cleaned.rstrip(".,!?;:").strip()))

    if keyword == "find":
        cleaned = text
        for prefix in ["find my","find the","find"]:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip(); break
        loc, loc_start = _extract_location(cleaned)
        if loc:
            detected_location = _validate_location(_dedupe_words(loc))
            cleaned = cleaned[:loc_start].strip()
        detected_object = _validate_object(_dedupe_words(cleaned.rstrip(".,!?;:").strip()))

    return {"keyword":keyword,"object":detected_object,"location":detected_location}


def transcribe_audio(audio_b64, language_code="en"):
    from groq import Groq
    import base64
    groq_client = Groq(api_key=GROQ_API_KEY)

    audio_bytes = base64.b64decode(audio_b64)

    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tmp_in:
        tmp_in.write(audio_bytes)
        tmp_in_path = tmp_in.name

    tmp_out_path = tmp_in_path.replace(".m4a", ".wav")

    try:
        subprocess.run(
            ["/workspace/ffmpeg_bin", "-y", "-i", tmp_in_path,
             "-ar", "16000", "-ac", "1", "-f", "wav", tmp_out_path],
            capture_output=True
        )

        audio_file_path = tmp_out_path if os.path.exists(tmp_out_path) else tmp_in_path

        with open(audio_file_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(audio_file_path), f.read()),
                model="whisper-large-v3",
                language="en",
                response_format="text",
                prompt="describe recognize identify where find stop"
            )

        if isinstance(transcription, str):
            return transcription.strip()
        result = transcription.text.strip() if hasattr(transcription, 'text') else str(transcription).strip()

        HALLUCINATIONS = [
            'اشتركوا', 'القناة', 'subscribe', 'subtitles', 'transcribed',
            'www.', '.com', 'http', 'thank you for watching', 'شكرا للمشاهدة',
        ]
        result_lower = result.lower()
        for h in HALLUCINATIONS:
            if h.lower() in result_lower:
                return ''
        return result

    finally:
        if os.path.exists(tmp_in_path): os.remove(tmp_in_path)
        if os.path.exists(tmp_out_path): os.remove(tmp_out_path)