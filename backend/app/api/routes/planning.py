"""Opgaver, projekter og kalender."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.core.config import get_settings
from app.db.models import CalendarEvent, Project, Task
from app.db.session import get_db
from app.services import calendar as cal

router = APIRouter(prefix="/api", tags=["planning"], dependencies=[Depends(current_user)])
TZ = ZoneInfo(get_settings().timezone)


# ---------------- Opgaver ----------------
class TaskIn(BaseModel):
    title: str
    notes: str = ""
    priority: int = 2
    due_at: datetime | None = None
    remind_at: datetime | None = None
    estimate_minutes: int | None = None
    project_id: int | None = None
    status: str = "todo"


def _task(t: Task) -> dict:
    return {"id": t.id, "title": t.title, "notes": t.notes, "status": t.status, "priority": t.priority,
            "due_at": t.due_at, "remind_at": t.remind_at, "estimate_minutes": t.estimate_minutes,
            "project_id": t.project_id, "completed_at": t.completed_at, "created_at": t.created_at}


@router.get("/tasks")
async def list_tasks(status: str | None = None, project_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = select(Task).order_by(Task.status, Task.priority, Task.due_at.nulls_last())
    if status:
        q = q.where(Task.status == status)
    if project_id:
        q = q.where(Task.project_id == project_id)
    return [_task(t) for t in (await db.scalars(q.limit(500))).all()]


@router.post("/tasks")
async def create_task(body: TaskIn, db: AsyncSession = Depends(get_db)):
    t = Task(**body.model_dump())
    db.add(t)
    await db.commit()
    return _task(t)


@router.patch("/tasks/{tid}")
async def update_task(tid: int, body: dict, db: AsyncSession = Depends(get_db)):
    t = await db.get(Task, tid)
    if not t:
        raise HTTPException(404, "Opgaven findes ikke")
    allowed = {"title", "notes", "status", "priority", "due_at", "remind_at", "estimate_minutes", "project_id"}
    for k, v in body.items():
        if k in allowed:
            if k in ("due_at", "remind_at") and isinstance(v, str):
                v = datetime.fromisoformat(v.replace("Z", "+00:00"))
            setattr(t, k, v)
    if body.get("status") == "done" and not t.completed_at:
        t.completed_at = datetime.now(timezone.utc)
    elif body.get("status") and body["status"] != "done":
        t.completed_at = None
    if "remind_at" in body:
        t.reminded = False
    await db.commit()
    return _task(t)


@router.delete("/tasks/{tid}")
async def delete_task(tid: int, db: AsyncSession = Depends(get_db)):
    t = await db.get(Task, tid)
    if t:
        await db.delete(t)
        await db.commit()
    return {"ok": True}


# ---------------- Projekter ----------------
class ProjectIn(BaseModel):
    name: str
    description: str = ""
    status: str = "active"
    folder: str = ""
    deadline: datetime | None = None


@router.get("/projects")
async def list_projects(db: AsyncSession = Depends(get_db)):
    projects = (await db.scalars(select(Project).order_by(Project.status, Project.updated_at.desc()))).all()
    counts = dict((await db.execute(select(Task.project_id, func.count()).where(Task.status != "done")
                                    .group_by(Task.project_id))).all())
    return [{"id": p.id, "name": p.name, "description": p.description, "status": p.status, "folder": p.folder,
             "deadline": p.deadline, "open_tasks": counts.get(p.id, 0), "updated_at": p.updated_at} for p in projects]


@router.post("/projects")
async def create_project(body: ProjectIn, db: AsyncSession = Depends(get_db)):
    p = Project(**body.model_dump())
    db.add(p)
    await db.commit()
    return {"id": p.id}


@router.patch("/projects/{pid}")
async def update_project(pid: int, body: ProjectIn, db: AsyncSession = Depends(get_db)):
    p = await db.get(Project, pid)
    if not p:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    await db.commit()
    return {"ok": True}


@router.delete("/projects/{pid}")
async def delete_project(pid: int, db: AsyncSession = Depends(get_db)):
    p = await db.get(Project, pid)
    if p:
        await db.delete(p)
        await db.commit()
    return {"ok": True}


# ---------------- Kalender ----------------
class EventIn(BaseModel):
    title: str
    start: datetime
    end: datetime | None = None
    description: str = ""
    location: str = ""
    remind_minutes: int | None = 15
    calendar: str | None = None


def _ev(e: CalendarEvent) -> dict:
    return {"id": e.id, "title": e.title, "start": e.start, "end": e.end, "all_day": e.all_day, "location": e.location,
            "description": e.description, "calendar": e.calendar, "remind_minutes": e.remind_minutes}


@router.get("/calendar/events")
async def events(start: datetime | None = None, days: int = 7, db: AsyncSession = Depends(get_db)):
    start = start or datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    if not start.tzinfo:
        start = start.replace(tzinfo=TZ)
    return [_ev(e) for e in await cal.events_between(db, start, start + timedelta(days=min(days, 62)))]


@router.post("/calendar/events")
async def create_event(body: EventIn, db: AsyncSession = Depends(get_db)):
    try:
        e = await cal.create_event(db, body.title, body.start, body.end, body.description, body.location,
                                   body.remind_minutes, body.calendar)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return _ev(e)


@router.delete("/calendar/events/{eid}")
async def delete_event(eid: int, db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEvent, eid)
    if not e:
        raise HTTPException(404)
    await cal.delete_event(db, e)
    return {"ok": True}


@router.post("/calendar/sync")
async def sync(db: AsyncSession = Depends(get_db)):
    try:
        return await cal.sync(db)
    except Exception as e:
        raise HTTPException(502, f"Synkronisering fejlede: {e}")


@router.get("/calendar/status")
async def status():
    s = get_settings()
    return {"caldav_configured": cal.caldav_enabled(), "url": s.caldav_url, "username": s.caldav_username}
