"""Automatiseringer og faste baggrundsjob (APScheduler, kører 24/7 i backend-processen)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import Automation, AutomationRun, CalendarEvent, Conversation, Task
from app.db.session import SessionLocal

log = logging.getLogger("jarvis.automation")
_s = get_settings()
TZ = ZoneInfo(_s.timezone)
scheduler = AsyncIOScheduler(timezone=TZ)

KINDS = {
    "agent_prompt": "Kør en prompt mod en agent (fx 'Lav en nyhedsoversigt om AI') og send resultatet",
    "daily_report": "Dagsrapport: dagens aftaler, opgaver, deadlines og forslag til plan",
    "url_check": "Tjek en webside og giv besked hvis den indeholder/ikke indeholder en tekst",
    "notify": "Send en fast påmindelse",
}


def validate_cron(expr: str) -> None:
    CronTrigger.from_crontab(expr, timezone=TZ)  # kaster ValueError ved ugyldigt udtryk


async def build_daily_report(db) -> str:
    from app.services.calendar import events_between
    now = datetime.now(TZ)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    evs = await events_between(db, day0, day0 + timedelta(days=1))
    open_tasks = (await db.scalars(select(Task).where(Task.status != "done").order_by(Task.priority, Task.due_at.nulls_last())
                                   .limit(30))).all()
    overdue = [t for t in open_tasks if t.due_at and t.due_at < now]
    soon = [t for t in open_tasks if t.due_at and now <= t.due_at < now + timedelta(days=3)]
    lines = [f"Dagsrapport {now:%A %d.%m.%Y}", "", "Aftaler i dag:"]
    lines += [f"• {e.start.astimezone(TZ):%H:%M}–{e.end.astimezone(TZ):%H:%M} {e.title}" for e in evs] or ["• Ingen"]
    lines += ["", f"Overskredne deadlines ({len(overdue)}):"] + [f"• {t.title} (frist {t.due_at.astimezone(TZ):%d.%m})" for t in overdue]
    lines += ["", f"Deadlines de næste 3 dage ({len(soon)}):"] + [f"• {t.title} ({t.due_at.astimezone(TZ):%a %d.%m %H:%M})" for t in soon]
    lines += ["", "Top-prioriteter:"] + [f"• P{t.priority} {t.title}" for t in open_tasks[:5]]
    return "\n".join(lines)


async def run_automation(automation_id: int) -> None:
    from app.services.notify import notify
    async with SessionLocal() as db:
        a = await db.get(Automation, automation_id)
        if not a or not a.enabled:
            return
        run = AutomationRun(automation_id=a.id)
        db.add(run)
        await db.commit()
        try:
            cfg = a.config or {}
            if a.kind == "daily_report":
                out = await build_daily_report(db)
            elif a.kind == "notify":
                out = cfg.get("message", a.name)
            elif a.kind == "url_check":
                from app.tools.web import fetch
                page = await fetch(cfg["url"])
                found = cfg.get("contains", "").lower() in page["text"].lower()
                trigger = found if cfg.get("notify_when", "found") == "found" else not found
                out = f"'{cfg.get('contains')}' {'fundet' if found else 'ikke fundet'} på {cfg['url']}"
                if not trigger:
                    run.status, run.output = "ok", out + " (ingen notifikation)"
                    a.last_status, a.last_output, a.last_run_at = "ok", run.output, datetime.now(timezone.utc)
                    run.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return
            elif a.kind == "agent_prompt":
                from app.services.assistant import chat
                conv = Conversation(title=f"⚙️ {a.name} {datetime.now(TZ):%d.%m %H:%M}", agent=cfg.get("agent", "main"))
                db.add(conv)
                await db.commit()
                parts = []
                async for ev in chat(db, conv, cfg["prompt"], agent=cfg.get("agent")):
                    if ev.type == "token":
                        parts.append(ev.data["text"])
                out = "".join(parts)
            else:
                raise ValueError(f"Ukendt type {a.kind}")
            await notify(db, a.name, out[:3500], link="/automations",
                         channels=tuple(cfg.get("channels", ["dashboard", "push"])))
            run.status, run.output = "ok", out
        except Exception as e:
            log.exception("Automatisering %s fejlede", a.id)
            run.status, run.output = "error", str(e)
        run.finished_at = datetime.now(timezone.utc)
        a.last_run_at, a.last_status, a.last_output = run.finished_at, run.status, run.output[:5000]
        await db.commit()


def schedule(a: Automation) -> None:
    job_id = f"automation-{a.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    if a.enabled:
        scheduler.add_job(run_automation, CronTrigger.from_crontab(a.cron, timezone=TZ), args=[a.id], id=job_id,
                          misfire_grace_time=600, coalesce=True, max_instances=1)


def unschedule(automation_id: int) -> None:
    job_id = f"automation-{automation_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)


async def check_reminders() -> None:
    """Hvert minut: påmindelser for opgaver og kalenderaftaler."""
    from app.services.notify import notify
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        for t in (await db.scalars(select(Task).where(Task.remind_at <= now, Task.reminded.is_(False),
                                                       Task.status != "done"))).all():
            await notify(db, f"Påmindelse: {t.title}", t.notes or "", link="/tasks")
            t.reminded = True
        upcoming = (await db.scalars(select(CalendarEvent).where(CalendarEvent.reminded.is_(False),
                                                                 CalendarEvent.remind_minutes.is_not(None),
                                                                 CalendarEvent.start > now,
                                                                 CalendarEvent.start <= now + timedelta(hours=2)))).all()
        for e in upcoming:
            if e.start - timedelta(minutes=e.remind_minutes or 0) <= now:
                await notify(db, f"Om {e.remind_minutes} min: {e.title}",
                             f"{e.start.astimezone(TZ):%H:%M} {e.location}".strip(), link="/calendar")
                e.reminded = True
        await db.commit()


async def periodic_maintenance() -> None:
    from app.memory.service import memory_service
    from app.services.calendar import caldav_enabled, sync
    async with SessionLocal() as db:
        await memory_service.maintenance(db)
        if caldav_enabled():
            try:
                await sync(db)
            except Exception as e:
                log.warning("Kalendersynk fejlede: %s", e)


async def start() -> None:
    async with SessionLocal() as db:
        for a in (await db.scalars(select(Automation))).all():
            try:
                schedule(a)
            except ValueError as e:
                log.error("Ugyldig cron for automation %s: %s", a.id, e)
    scheduler.add_job(check_reminders, "interval", minutes=1, id="reminders", replace_existing=True)
    scheduler.add_job(periodic_maintenance, "interval", minutes=15, id="maintenance", replace_existing=True)
    scheduler.add_job(nightly_backup, CronTrigger(hour=3, minute=17, timezone=TZ), id="backup", replace_existing=True)
    scheduler.start()


async def nightly_backup() -> None:
    from app.services.backup import run_backup
    try:
        await run_backup()
    except Exception as e:
        log.error("Natlig backup fejlede: %s", e)
