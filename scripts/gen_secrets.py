#!/usr/bin/env python3
"""Genererer stærke hemmeligheder og skriver dem ind i .env (opretter fra .env.example)."""
import base64
import os
import re
import secrets
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = ROOT / ".env"
if not env.exists():
    shutil.copy(ROOT / ".env.example", env)

text = env.read_text()
values = {
    "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
    "QDRANT_API_KEY": secrets.token_urlsafe(32),
    "JARVIS_MASTER_KEY": base64.urlsafe_b64encode(os.urandom(32)).decode(),
    "JWT_SECRET": secrets.token_urlsafe(48),
    "NTFY_TOPIC": "jarvis-" + secrets.token_hex(12),
}
for key, val in values.items():
    # Overskriv kun tomme værdier, så eksisterende hemmeligheder bevares
    text = re.sub(rf"^{key}=\s*$", f"{key}={val}", text, flags=re.M)
env.write_text(text)
os.chmod(env, 0o600)

searx = ROOT / "infra/searxng/settings.yml"
s = searx.read_text()
if "CHANGE_ME" in s:
    searx.write_text(s.replace("CHANGE_ME", secrets.token_hex(32)))

print("Hemmeligheder skrevet til .env (rettigheder 600). Udfyld ADMIN_EMAIL og ADMIN_PASSWORD.")
