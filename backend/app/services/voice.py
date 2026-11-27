"""Tale: speech-to-text med faster-whisper og text-to-speech med Piper – begge lokalt og gratis.
Fallback til OpenAI (whisper-1 / tts) hvis en nøgle er konfigureret og lokal model mangler."""
from __future__ import annotations

import asyncio
import io
import logging
import tempfile
import wave
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger("jarvis.voice")
_s = get_settings()

PIPER_VOICES = {
    "da": "da_DK-talesyntese-medium",
    "en": "en_GB-alan-medium",
}


@lru_cache
def _whisper():
    from faster_whisper import WhisperModel
    return WhisperModel(_s.whisper_model, device="auto", compute_type="int8",
                        download_root=str(_s.voice_model_dir / "whisper"))


def _transcribe(data: bytes, language: str | None) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".webm") as f:
        f.write(data)
        f.flush()
        segments, info = _whisper().transcribe(f.name, language=language, vad_filter=True, beam_size=5)
        text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": info.language, "duration": info.duration}


async def transcribe(data: bytes, language: str | None = "da") -> dict:
    return await asyncio.to_thread(_transcribe, data, language)


@lru_cache(maxsize=4)
def _piper(voice: str):
    from piper.voice import PiperVoice
    model = _s.voice_model_dir / "piper" / f"{voice}.onnx"
    if not model.exists():
        raise FileNotFoundError(f"Piper-stemme mangler: {model}. Kør scripts/download_voices.sh")
    return PiperVoice.load(str(model))


def _synthesize(text: str, lang: str) -> bytes:
    voice = _piper(PIPER_VOICES.get(lang, _s.piper_voice))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        voice.synthesize(text, wav)
    return buf.getvalue()


async def synthesize(text: str, lang: str = "da") -> tuple[bytes, str]:
    text = text.strip()[:4000]
    try:
        return await asyncio.to_thread(_synthesize, text, lang), "audio/wav"
    except Exception as e:
        log.warning("Piper utilgængelig (%s) – prøver cloud-TTS", e)
    from app.db.session import SessionLocal
    from app.llm.registry import registry
    async with SessionLocal() as db:
        specs = [s for s in await registry.specs(db) if s.provider == "openai" and s.api_key]
    if not specs:
        raise RuntimeError("Ingen TTS tilgængelig. Installer Piper-stemmen eller tilføj en OpenAI-nøgle.")
    import httpx
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post("https://api.openai.com/v1/audio/speech",
                         headers={"Authorization": f"Bearer {specs[0].api_key}"},
                         json={"model": "gpt-4o-mini-tts", "voice": "alloy", "input": text, "format": "mp3"})
        r.raise_for_status()
        return r.content, "audio/mpeg"


def voice_status() -> dict:
    piper_dir = _s.voice_model_dir / "piper"
    return {
        "whisper_model": _s.whisper_model,
        "piper_voices": sorted(p.stem for p in piper_dir.glob("*.onnx")) if piper_dir.exists() else [],
        "whisper_cached": (Path(_s.voice_model_dir) / "whisper").exists(),
    }
