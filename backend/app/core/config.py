"""Central konfiguration. Læses fra miljøvariabler (se .env.example)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


class Settings(BaseModel):
    database_url: str = Field(default_factory=lambda: _env("DATABASE_URL", "postgresql+asyncpg://jarvis:jarvis@localhost:5432/jarvis"))
    qdrant_url: str = Field(default_factory=lambda: _env("QDRANT_URL", "http://localhost:6333"))
    qdrant_api_key: str = Field(default_factory=lambda: _env("QDRANT_API_KEY"))
    ollama_url: str = Field(default_factory=lambda: _env("OLLAMA_URL", "http://localhost:11434"))
    searxng_url: str = Field(default_factory=lambda: _env("SEARXNG_URL", "http://localhost:8080"))

    master_key: str = Field(default_factory=lambda: _env("JARVIS_MASTER_KEY"))
    jwt_secret: str = Field(default_factory=lambda: _env("JWT_SECRET"))
    jwt_ttl_minutes: int = Field(default_factory=lambda: int(_env("JWT_TTL_MINUTES", "720")))
    admin_email: str = Field(default_factory=lambda: _env("ADMIN_EMAIL"))
    admin_password: str = Field(default_factory=lambda: _env("ADMIN_PASSWORD"))
    frontend_origin: str = Field(default_factory=lambda: _env("FRONTEND_ORIGIN", "http://localhost:3000"))

    ollama_default_model: str = Field(default_factory=lambda: _env("OLLAMA_DEFAULT_MODEL", "qwen2.5:7b-instruct"))
    ollama_large_model: str = Field(default_factory=lambda: _env("OLLAMA_LARGE_MODEL", "qwen2.5:14b-instruct"))
    ollama_code_model: str = Field(default_factory=lambda: _env("OLLAMA_CODE_MODEL", "qwen2.5-coder:7b"))
    ollama_embed_model: str = Field(default_factory=lambda: _env("OLLAMA_EMBED_MODEL", "nomic-embed-text"))
    openai_api_key: str = Field(default_factory=lambda: _env("OPENAI_API_KEY"))
    anthropic_api_key: str = Field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    cloud_budget_dkk_month: float = Field(default_factory=lambda: float(_env("CLOUD_BUDGET_DKK_MONTH", "400")))

    brave_api_key: str = Field(default_factory=lambda: _env("BRAVE_API_KEY"))

    caldav_url: str = Field(default_factory=lambda: _env("CALDAV_URL", "https://caldav.icloud.com"))
    caldav_username: str = Field(default_factory=lambda: _env("CALDAV_USERNAME"))
    caldav_password: str = Field(default_factory=lambda: _env("CALDAV_PASSWORD"))

    ntfy_url: str = Field(default_factory=lambda: _env("NTFY_URL", "https://ntfy.sh"))
    ntfy_topic: str = Field(default_factory=lambda: _env("NTFY_TOPIC"))
    smtp_host: str = Field(default_factory=lambda: _env("SMTP_HOST"))
    smtp_port: int = Field(default_factory=lambda: int(_env("SMTP_PORT", "587")))
    smtp_user: str = Field(default_factory=lambda: _env("SMTP_USER"))
    smtp_password: str = Field(default_factory=lambda: _env("SMTP_PASSWORD"))
    notify_email: str = Field(default_factory=lambda: _env("NOTIFY_EMAIL"))

    upload_dir: Path = Field(default_factory=lambda: Path(_env("UPLOAD_DIR", "/data/uploads")))
    backup_dir: Path = Field(default_factory=lambda: Path(_env("BACKUP_DIR", "/data/backups")))
    voice_model_dir: Path = Field(default_factory=lambda: Path(_env("VOICE_MODEL_DIR", "/data/voice-models")))
    workspace_roots: list[str] = Field(default_factory=lambda: [p for p in _env("WORKSPACE_ROOTS", "/workspace").split(",") if p])

    whisper_model: str = Field(default_factory=lambda: _env("WHISPER_MODEL", "small"))
    piper_voice: str = Field(default_factory=lambda: _env("PIPER_VOICE", "da_DK-talesyntese-medium"))
    timezone: str = Field(default_factory=lambda: _env("TZ", "Europe/Copenhagen"))

    def validate_required(self) -> list[str]:
        missing = [n for n, v in {
            "JARVIS_MASTER_KEY": self.master_key,
            "JWT_SECRET": self.jwt_secret,
        }.items() if not v]
        return missing


@lru_cache
def get_settings() -> Settings:
    return Settings()
