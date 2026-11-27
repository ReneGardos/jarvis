"""Alle indbyggede værktøjer. Hvert værktøj har et risikoniveau som policy-motoren håndhæver."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import get_settings
from app.core.injection import wrap_untrusted
from app.core.policy import Risk
from app.tools import web
from app.tools.framework import Tool, ToolContext, registry
from app.tools.sandbox import Sandbox

_s = get_settings()
TZ = ZoneInfo(_s.timezone)
sandbox = Sandbox(_s.workspace_roots)


def _dt(v: str | None) -> datetime | None:
    if not v:
        return None
    d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=TZ)


def reg(name, description, params, risk, taints=False, summary=None):
    def deco(fn):
        registry.register(Tool(name, description, params, risk, fn, taints, summary))
        return fn
    return deco


# ---------------- Hukommelse ----------------
@reg("memory_search", "Søg i din langtids- og korttidshukommelse om brugeren.", {"query": "søgetekst"}, Risk.READ)
async def _memory_search(ctx: ToolContext, a: dict):
    from app.memory.service import memory_service
    ms = await memory_service.search(ctx.db, a["query"], limit=8)
    return [{"id": m.id, "kind": m.kind, "content": m.content, "tier": m.tier} for m in ms]


@reg("memory_save", "Gem en vigtig oplysning om brugeren permanent.",
     {"kind": "preference|fact|project|decision|plan|person|task", "content": "kort sætning", "importance": "0-1"},
     Risk.WRITE_LOCAL, summary=lambda a: f"Gem i hukommelsen: {a.get('content')}")
async def _memory_save(ctx: ToolContext, a: dict):
    from app.memory.service import memory_service
    m = await memory_service.add(ctx.db, a.get("kind", "fact"), a["content"], float(a.get("importance", 0.6)),
                                 conversation_id=ctx.conversation_id)
    return {"id": m.id, "tier": m.tier}


# ---------------- Internet ----------------
@reg("web_search", "Søg på internettet (Google, Bing, DuckDuckGo m.fl.).", {"query": "søgetekst", "lang": "da eller en"},
     Risk.READ, taints=True)
async def _web_search(ctx: ToolContext, a: dict):
    res = await web.search(a["query"], lang=a.get("lang", "da"))
    for r in res:
        ctx.sources.append({"title": r["title"], "url": r["url"]})
    text = "\n".join(f"[{i}] {r['title']} – {r['url']}\n{r['snippet']}" for i, r in enumerate(res, 1))
    return wrap_untrusted(text, "websøgning")[0]


@reg("fetch_url", "Hent og læs indholdet af en webside eller online-PDF.", {"url": "fuld URL"}, Risk.READ, taints=True)
async def _fetch(ctx: ToolContext, a: dict):
    page = await web.fetch(a["url"])
    ctx.sources.append({"title": page["title"] or page["url"], "url": page["url"]})
    wrapped, scan = wrap_untrusted(page["text"], page["url"])
    return {"title": page["title"], "content": wrapped, "injection_warning": scan.suspicious}


# ---------------- Opgaver ----------------
@reg("task_list", "Vis opgaver.", {"status": "todo|doing|done|all"}, Risk.READ)
async def _task_list(ctx: ToolContext, a: dict):
    from app.db.models import Task
    q = select(Task).order_by(Task.priority, Task.due_at.nulls_last())
    if a.get("status", "todo") != "all":
        q = q.where(Task.status == a.get("status", "todo"))
    rows = (await ctx.db.scalars(q.limit(100))).all()
    return [{"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
             "due": t.due_at.isoformat() if t.due_at else None} for t in rows]


@reg("task_create", "Opret en opgave.", {"title": "titel", "due": "ISO-dato/tid (valgfri)", "priority": "1-4",
     "notes": "noter", "remind": "ISO-tidspunkt for påmindelse (valgfri)"}, Risk.WRITE_LOCAL,
     summary=lambda a: f"Opret opgave: {a.get('title')}")
async def _task_create(ctx: ToolContext, a: dict):
    from app.db.models import Task
    t = Task(title=a["title"][:300], notes=a.get("notes", ""), priority=int(a.get("priority", 2)),
             due_at=_dt(a.get("due")), remind_at=_dt(a.get("remind")))
    ctx.db.add(t)
    await ctx.db.commit()
    return {"id": t.id}


@reg("task_update", "Ændr eller afslut en opgave.", {"id": "opgave-id", "status": "todo|doing|done", "title": "", "due": "",
     "priority": ""}, Risk.MODIFY, summary=lambda a: f"Opdatér opgave #{a.get('id')}: {a}")
async def _task_update(ctx: ToolContext, a: dict):
    from app.db.models import Task
    t = await ctx.db.get(Task, int(a["id"]))
    if not t:
        raise ValueError("Opgaven findes ikke")
    if a.get("status"):
        t.status = a["status"]
        t.completed_at = datetime.now(TZ) if a["status"] == "done" else None
    if a.get("title"):
        t.title = a["title"]
    if a.get("due"):
        t.due_at = _dt(a["due"])
    if a.get("priority"):
        t.priority = int(a["priority"])
    await ctx.db.commit()
    return {"id": t.id, "status": t.status}


# ---------------- Kalender ----------------
@reg("calendar_list", "Vis kalenderaftaler i et tidsrum.", {"start": "ISO-dato", "days": "antal dage (standard 1)"}, Risk.READ)
async def _cal_list(ctx: ToolContext, a: dict):
    from app.services.calendar import events_between
    start = _dt(a.get("start")) or datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    evs = await events_between(ctx.db, start, start + timedelta(days=int(a.get("days", 1))))
    return [{"id": e.id, "title": e.title, "start": e.start.astimezone(TZ).isoformat(),
             "end": e.end.astimezone(TZ).isoformat(), "location": e.location, "calendar": e.calendar} for e in evs]


@reg("calendar_free_slots", "Find ledige tidsrum på en dag.", {"date": "YYYY-MM-DD", "min_minutes": "minimum varighed",
     "from_hour": "start (standard 8)", "to_hour": "slut (standard 17)"}, Risk.READ)
async def _cal_free(ctx: ToolContext, a: dict):
    from app.services.calendar import events_between, find_free_slots
    d = datetime.fromisoformat(a["date"]).replace(tzinfo=TZ)
    ds, de = d.replace(hour=int(a.get("from_hour", 8))), d.replace(hour=int(a.get("to_hour", 17)))
    evs = await events_between(ctx.db, ds, de)
    slots = find_free_slots([(e.start, e.end) for e in evs if not e.all_day], ds, de, int(a.get("min_minutes", 30)))
    return [{"start": s.isoformat(), "end": e.isoformat()} for s, e in slots]


@reg("calendar_create", "Opret en kalenderaftale (synkroniseres til Apple Kalender).",
     {"title": "titel", "start": "ISO-tid", "end": "ISO-tid", "location": "", "description": ""}, Risk.MODIFY,
     summary=lambda a: f"Opret aftale '{a.get('title')}' {a.get('start')}–{a.get('end')}")
async def _cal_create(ctx: ToolContext, a: dict):
    from app.services.calendar import create_event
    ev = await create_event(ctx.db, a["title"], _dt(a["start"]), _dt(a.get("end")), a.get("description", ""),
                            a.get("location", ""))
    return {"id": ev.id, "calendar": ev.calendar}


# ---------------- Dokumenter ----------------
@reg("document_search", "Søg i brugerens uploadede dokumenter.", {"query": "søgetekst", "document_id": "valgfri"},
     Risk.READ, taints=True)
async def _doc_search(ctx: ToolContext, a: dict):
    from app.documents.service import search
    hits = await search(a["query"], document_id=int(a["document_id"]) if a.get("document_id") else None)
    for h in hits:
        ctx.sources.append({"title": h.get("filename", "dokument"), "document_id": h.get("document_id")})
    text = "\n\n".join(f"[{h.get('filename')} #{h.get('chunk')}] {h.get('text', '')}" for h in hits)
    return wrap_untrusted(text, "dokumenter")[0]


@reg("document_create", "Opret et dokument (docx, xlsx eller md) til brugeren.",
     {"kind": "docx|xlsx|md", "title": "titel", "content": "tekst (markdown) eller rækker for xlsx"}, Risk.WRITE_LOCAL,
     summary=lambda a: f"Opret dokument: {a.get('title')}")
async def _doc_create(ctx: ToolContext, a: dict):
    from app.db.models import Document
    from app.documents.service import create_file
    path = create_file(a.get("kind", "md"), a["title"], a["content"])
    doc = Document(filename=path.name, path=str(path), mime="application/octet-stream", size=path.stat().st_size,
                   sha256="", folder="Genereret", status="ready")
    ctx.db.add(doc)
    await ctx.db.commit()
    return {"document_id": doc.id, "filename": path.name, "download": f"/api/documents/{doc.id}/download"}


# ---------------- Filer & kode ----------------
@reg("fs_list", "Vis filer i en projektmappe.", {"path": "relativ sti", "depth": "1-4"}, Risk.READ)
async def _fs_list(ctx, a):
    return sandbox.list_dir(a.get("path", "."), int(a.get("depth", 2)))


@reg("fs_read", "Læs en fil i en projektmappe.", {"path": "sti"}, Risk.READ, taints=True)
async def _fs_read(ctx, a):
    return wrap_untrusted(sandbox.read(a["path"]), a["path"])[0]


@reg("fs_search", "Søg efter tekst i projektfiler.", {"pattern": "tekst", "path": "mappe"}, Risk.READ)
async def _fs_search(ctx, a):
    return sandbox.search(a["pattern"], a.get("path", "."))


@reg("fs_write", "Skriv/overskriv en fil (der laves automatisk backup). Kræver godkendelse.",
     {"path": "sti", "content": "hele filens nye indhold"}, Risk.MODIFY,
     summary=lambda a: f"Skriv {len(a.get('content', ''))} tegn til {a.get('path')}")
async def _fs_write(ctx, a):
    return sandbox.write(a["path"], a["content"])


@reg("run_command", "Kør tests/lint/build i et projekt (kun godkendte kommandoer som pytest, npm test, npm run build).",
     {"command": "kommando", "cwd": "mappe"}, Risk.MODIFY, summary=lambda a: f"Kør `{a.get('command')}` i {a.get('cwd', '.')}")
async def _run(ctx, a):
    sandbox.check_command(a["command"])
    return await sandbox.run(a["command"], a.get("cwd", "."))


# ---------------- Notifikation ----------------
@reg("notify_user", "Send brugeren en påmindelse/notifikation til mobil og dashboard.",
     {"title": "titel", "body": "tekst"}, Risk.WRITE_LOCAL)
async def _notify(ctx, a):
    from app.services.notify import notify
    return await notify(ctx.db, a["title"], a.get("body", ""))


@reg("http_post", "Send data til en ekstern API (kræver altid godkendelse).",
     {"url": "URL", "json": "objekt der sendes"}, Risk.EXTERNAL, summary=lambda a: f"POST til {a.get('url')}")
async def _http_post(ctx, a):
    import httpx
    await web.assert_public_url(a["url"])
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(a["url"], json=a.get("json", {}))
    return {"status": r.status_code, "body": r.text[:3000]}


@reg("current_time", "Aktuel dato og tid.", {}, Risk.READ)
async def _now(ctx, a):
    n = datetime.now(TZ)
    return {"iso": n.isoformat(), "weekday": ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"][n.weekday()],
            "week": n.isocalendar().week}
