"""Notifikationer: dashboard (database), push til mobil via ntfy og e-mail via SMTP."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import Notification

log = logging.getLogger("jarvis.notify")
_s = get_settings()


async def push(title: str, body: str, priority: str = "default", click: str = "") -> bool:
    if not _s.ntfy_topic:
        return False
    import httpx
    headers = {"Title": title.encode("utf-8").decode("latin-1", "ignore"), "Priority": priority, "Tags": "robot"}
    if click:
        headers["Click"] = click
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{_s.ntfy_url.rstrip('/')}/{_s.ntfy_topic}", content=body.encode(), headers=headers)
            return r.status_code < 300
    except Exception as e:
        log.warning("ntfy fejlede: %s", e)
        return False


def _send_mail(subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, _s.smtp_user, _s.notify_email
    msg.set_content(body)
    with smtplib.SMTP(_s.smtp_host, _s.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(_s.smtp_user, _s.smtp_password)
        smtp.send_message(msg)


async def email(subject: str, body: str) -> bool:
    if not (_s.smtp_host and _s.notify_email):
        return False
    try:
        await asyncio.to_thread(_send_mail, subject, body)
        return True
    except Exception as e:
        log.warning("E-mail fejlede: %s", e)
        return False


async def notify(db: AsyncSession, title: str, body: str = "", level: str = "info", link: str = "",
                 channels: tuple[str, ...] = ("dashboard", "push")) -> dict:
    db.add(Notification(title=title, body=body, level=level, link=link))
    await db.commit()
    sent = {"dashboard": True}
    if "push" in channels:
        sent["push"] = await push(title, body, "high" if level == "urgent" else "default")
    if "email" in channels:
        sent["email"] = await email(title, body)
    return sent
