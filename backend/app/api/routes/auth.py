from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import client_ip, current_user
from app.core.config import get_settings
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.db.models import AuthSession, User
from app.db.session import get_db
from app.services.audit import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])
MAX_FAILED, LOCK_MINUTES = 5, 15


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/login", summary="Log ind og få et adgangstoken")
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    s = get_settings()
    user = await db.scalar(select(User).where(User.email == body.email.lower().strip()))
    now = datetime.now(timezone.utc)
    if user and user.locked_until and user.locked_until > now:
        raise HTTPException(429, "For mange forsøg – prøv igen om lidt")
    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED:
                user.locked_until, user.failed_logins = now + timedelta(minutes=LOCK_MINUTES), 0
        await audit(db, "anonymous", "auth.login_failed", body.email, "deny", ip=client_ip(request))
        raise HTTPException(401, "Forkert e-mail eller adgangskode")
    user.failed_logins, user.locked_until = 0, None
    sid = secrets.token_urlsafe(32)
    db.add(AuthSession(id=sid, user_id=user.id, user_agent=request.headers.get("user-agent", "")[:300],
                       ip=client_ip(request), expires_at=now + timedelta(minutes=s.jwt_ttl_minutes)))
    await audit(db, "user", "auth.login", user.email, "allow", ip=client_ip(request))
    token = create_token(user.id, sid, s.jwt_secret, s.jwt_ttl_minutes)
    response.set_cookie("jarvis_token", token, httponly=True, secure=request.url.scheme == "https", samesite="strict",
                        max_age=s.jwt_ttl_minutes * 60)
    return {"access_token": token, "token_type": "bearer", "user": {"email": user.email, "name": user.display_name}}


@router.post("/logout")
async def logout(request: Request, response: Response, user: User = Depends(current_user),
                 db: AsyncSession = Depends(get_db)):
    token = request.headers.get("authorization", "").removeprefix("Bearer ") or request.cookies.get("jarvis_token", "")
    data = decode_token(token, get_settings().jwt_secret)
    await db.execute(update(AuthSession).where(AuthSession.id == data.session_id).values(revoked=True))
    await audit(db, "user", "auth.logout", user.email)
    response.delete_cookie("jarvis_token")
    return {"ok": True}


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "name": user.display_name, "language": user.language}


@router.post("/password")
async def change_password(body: PasswordIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Nuværende adgangskode er forkert")
    try:
        user.password_hash = hash_password(body.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Log alle andre sessioner ud
    await db.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked=True))
    await audit(db, "user", "auth.password_changed", user.email)
    return {"ok": True, "message": "Adgangskode ændret – log ind igen"}


@router.get("/sessions")
async def sessions(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked.is_(False))
                             .order_by(AuthSession.created_at.desc()))).all()
    return [{"id": r.id[:8], "user_agent": r.user_agent, "ip": r.ip, "created_at": r.created_at,
             "expires_at": r.expires_at} for r in rows]


@router.post("/sessions/revoke-all")
async def revoke_all(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked=True))
    await audit(db, "user", "auth.revoke_all", user.email)
    return {"ok": True}
