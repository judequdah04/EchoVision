import sys
sys.path.insert(0, "/workspace/echovision")
from core.config import ELEVENLABS_API_KEY, GROQ_API_KEY
from elevenlabs.client import ElevenLabs
from groq import Groq
import base64

_eleven = ElevenLabs(api_key=ELEVENLABS_API_KEY)
_groq   = Groq(api_key=GROQ_API_KEY)

ENGLISH_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"
ARABIC_VOICE_ID  = "EXAVITQu4vr4xnSDxMaL"

def translate_to_arabic(text):
    response = _groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role":"user","content":f"""أنت مساعد صوتي للمكفوفين. ترجم النص التالي إلى اللغة العربية الفصحى الواضحة والدقيقة.
يجب أن تكون الترجمة فصحى سليمة وطبيعية وسلسة وأمينة للمعنى الأصلي.
أعد فقط الترجمة العربية بدون أي إضافات أو شرح.

النص:
{text}"""}]
    )
    return response.choices[0].message.content.strip()

def speak(text, language="english"):
    if language == "arabic":
        text = translate_to_arabic(text)
    audio_iter = _eleven.text_to_speech.convert(
        voice_id=ENGLISH_VOICE_ID,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128"
    )
    audio_bytes = b"".join(chunk for chunk in audio_iter)
    return base64.b64encode(audio_bytes).decode("utf-8"), text