"""Kalender: lokal database + tovejs-synk med CalDAV (Apple iCloud, Google, Nextcloud, Fastmail)."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import CalendarEvent
from app.services.timeplan import find_free_slots  # noqa: F401  (genbruges af værktøjer)

log = logging.getLogger("jarvis.calendar")
_s = get_settings()
TZ = ZoneInfo(_s.timezone)


def caldav_enabled() -> bool:
    return bool(_s.caldav_username and _s.caldav_password)


def _client():
    import caldav
    return caldav.DAVClient(url=_s.caldav_url, username=_s.caldav_username, password=_s.caldav_password)


def _to_dt(v) -> tuple[datetime, bool]:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=TZ)), False
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=TZ), True
    raise ValueError(v)


def _fetch_remote(start: datetime, end: datetime) -> list[dict]:
    out = []
    principal = _client().principal()
    for cal in principal.calendars():
        try:
            events = cal.search(start=start, end=end, event=True, expand=True)
        except Exception as e:
            log.warning("Kalender %s kunne ikke læses: %s", cal.name, e)
            continue
        for ev in events:
            comp = ev.icalendar_component
            s, all_day = _to_dt(comp.get("dtstart").dt)
            e_raw = comp.get("dtend")
            e = _to_dt(e_raw.dt)[0] if e_raw else s + timedelta(hours=1)
            rid = comp.get("recurrence-id")
            uid = str(comp.get("uid")) + (f"@{rid.dt.isoformat()}" if rid else "")
            out.append(dict(uid=uid, calendar=cal.name or "iCloud", title=str(comp.get("summary", "(uden titel)")),
                            description=str(comp.get("description", "")), location=str(comp.get("location", "")),
                            start=s, end=e, all_day=all_day, remote_href=str(ev.url)))
    return out


async def sync(db: AsyncSession, days_back: int = 7, days_ahead: int = 60) -> dict:
    if not caldav_enabled():
        return {"synced": 0, "message": "CalDAV er ikke konfigureret"}
    now = datetime.now(TZ)
    start, end = now - timedelta(days=days_back), now + timedelta(days=days_ahead)
    remote = await asyncio.to_thread(_fetch_remote, start, end)
    existing = {e.uid: e for e in (await db.scalars(
        select(CalendarEvent).where(CalendarEvent.start >= start, CalendarEvent.start <= end,
                                    CalendarEvent.calendar != "local"))).all()}
    seen = set()
    for r in remote:
        seen.add(r["uid"])
        ev = existing.get(r["uid"])
        if ev:
            for k, v in r.items():
                setattr(ev, k, v)
        else:
            db.add(CalendarEvent(**r))
    removed = 0
    for uid, ev in existing.items():
        if uid not in seen:
            await db.delete(ev)
            removed += 1
    await db.commit()
    return {"synced": len(remote), "removed": removed}


def _create_remote(title: str, start: datetime, end: datetime, description: str, location: str,
                   calendar_name: str | None) -> tuple[str, str, str]:
    from icalendar import Calendar, Event
    principal = _client().principal()
    cals = principal.calendars()
    cal = next((c for c in cals if c.name == calendar_name), None) or cals[0]
    uid = f"{uuid.uuid4()}@jarvis"
    ical = Calendar()
    ical.add("prodid", "-//Jarvis//DA")
    ical.add("version", "2.0")
    ev = Event()
    ev.add("uid", uid)
    ev.add("summary", title)
    ev.add("dtstart", start)
    ev.add("dtend", end)
    ev.add("dtstamp", datetime.now(timezone.utc))
    if description:
        ev.add("description", description)
    if location:
        ev.add("location", location)
    ical.add_component(ev)
    saved = cal.save_event(ical.to_ical().decode())
    return uid, str(saved.url), cal.name or "iCloud"


async def create_event(db: AsyncSession, title: str, start: datetime, end: datetime | None = None,
                       description: str = "", location: str = "", remind_minutes: int | None = 15,
                       calendar_name: str | None = None) -> CalendarEvent:
    start = start if start.tzinfo else start.replace(tzinfo=TZ)
    end = end or start + timedelta(hours=1)
    end = end if end.tzinfo else end.replace(tzinfo=TZ)
    if end <= start:
        raise ValueError("Sluttidspunkt skal være efter start")
    uid, href, cal = f"{uuid.uuid4()}@jarvis-local", "", "local"
    if caldav_enabled():
        uid, href, cal = await asyncio.to_thread(_create_remote, title, start, end, description, location, calendar_name)
    ev = CalendarEvent(uid=uid, calendar=cal, title=title, description=description, location=location,
                       start=start, end=end, remote_href=href, remind_minutes=remind_minutes)
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


async def delete_event(db: AsyncSession, ev: CalendarEvent) -> None:
    if ev.remote_href and caldav_enabled():
        def _del():
            import caldav
            caldav.Event(client=_client(), url=ev.remote_href).delete()
        await asyncio.to_thread(_del)
    await db.delete(ev)
    await db.commit()


async def events_between(db: AsyncSession, start: datetime, end: datetime) -> list[CalendarEvent]:
    return list((await db.scalars(select(CalendarEvent).where(CalendarEvent.end >= start, CalendarEvent.start <= end)
                                  .order_by(CalendarEvent.start))).all())
