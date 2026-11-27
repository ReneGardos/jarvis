from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog

log = logging.getLogger("jarvis.audit")

_REDACT = {"password", "api_key", "token", "secret", "authorization"}


def _redact(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if any(r in k.lower() for r in _REDACT):
            out[k] = "[skjult]"
        elif isinstance(v, dict):
            out[k] = _redact(v)
        elif isinstance(v, str) and len(v) > 2000:
            out[k] = v[:2000] + "…"
        else:
            out[k] = v
    return out


async def audit(db: AsyncSession, actor: str, action: str, target: str = "", decision: str = "",
                details: dict | None = None, ip: str = "", commit: bool = True) -> None:
    entry = AuditLog(actor=actor, action=action, target=target[:300], decision=decision,
                     details=_redact(details or {}), ip=ip)
    db.add(entry)
    log.info("%s %s %s %s", actor, action, target, decision)
    if commit:
        await db.commit()
