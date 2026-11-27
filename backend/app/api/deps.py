from __future__ import annotations

from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.models import AuthSession, User
from app.db.session import get_db

bearer = HTTPBearer(auto_error=False)


async def _user_from_token(token: str, db: AsyncSession) -> User:
    try:
        data = decode_token(token, get_settings().jwt_secret)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Ugyldigt eller udløbet login")
    sess = await db.get(AuthSession, data.session_id)
    if not sess or sess.revoked or sess.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessionen er afsluttet")
    user = await db.get(User, data.user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bruger findes ikke")
    return user


async def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                       db: AsyncSession = Depends(get_db)) -> User:
    token = creds.credentials if creds else request.cookies.get("jarvis_token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login påkrævet")
    return await _user_from_token(token, db)


async def ws_user(ws: WebSocket, db: AsyncSession) -> User:
    token = ws.query_params.get("token") or ws.cookies.get("jarvis_token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login påkrævet")
    return await _user_from_token(token, db)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""
