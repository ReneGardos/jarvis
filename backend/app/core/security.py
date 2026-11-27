"""Adgangskoder (scrypt), login-tokens (JWT) og kryptering af hemmeligheder (Fernet)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from dataclasses import dataclass

import jwt
from cryptography.fernet import Fernet, InvalidToken

# scrypt-parametre (OWASP-anbefaling: N=2^17, r=8, p=1)
_N, _R, _P, _DKLEN = 2**17, 8, 1, 64


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Adgangskoden skal være mindst 12 tegn")
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=256 * 1024 * 1024)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(dk_b64)
        dk = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p),
                            dklen=len(expected), maxmem=256 * 1024 * 1024)
        return hmac.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


@dataclass
class TokenData:
    user_id: int
    session_id: str
    exp: int


def create_token(user_id: int, session_id: str, secret: str, ttl_minutes: int) -> str:
    now = int(time.time())
    payload = {"sub": str(user_id), "sid": session_id, "iat": now, "exp": now + ttl_minutes * 60, "typ": "access"}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> TokenData:
    """Kaster jwt.PyJWTError ved ugyldigt/udløbet token."""
    data = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["sub", "exp", "sid"]})
    if data.get("typ") != "access":
        raise jwt.InvalidTokenError("forkert tokentype")
    return TokenData(user_id=int(data["sub"]), session_id=data["sid"], exp=int(data["exp"]))


class SecretVault:
    """Krypterer API-nøgler og andre hemmeligheder før de gemmes i databasen."""

    def __init__(self, master_key: str):
        if not master_key:
            raise RuntimeError("JARVIS_MASTER_KEY mangler – kør scripts/gen_secrets.py")
        self._f = Fernet(master_key.encode())

    def encrypt(self, plaintext: str) -> str:
        return self._f.encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._f.decrypt(token.encode()).decode()
        except InvalidToken as e:
            raise ValueError("Kunne ikke dekryptere – forkert master key?") from e

    @staticmethod
    def mask(secret: str) -> str:
        return "••••" + secret[-4:] if len(secret) > 8 else "••••"
