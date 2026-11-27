"""Agenter, modeller, automatiseringer, godkendelser, sikkerhed, notifikationer, backup og stemme."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.definitions import AGENTS
from app.api.deps import current_user
from app.core.policy import Risk
from app.core.security import SecretVault
from app.core.config import get_settings
from app.db.models import (Approval, AuditLog, Automation, AutomationRun, CalendarEvent, Memory, ModelConfig,
                           Notification, Secret, Setting, Task, UsageRecord)
from app.db.session import get_db
from app.llm.registry import ollama, registry
from app.services import automation as auto
from app.services import backup, voice
from app.services.assistant import execute_approval, load_policy
from app.services.audit import audit
from app.tools.framework import registry as tools

router = APIRouter(prefix="/api", tags=["system"], dependencies=[Depends(current_user)])


async def _set(db: AsyncSession, key: str, value: dict) -> None:
    s = await db.get(Setting, key)
    if s:
        s.value = value
    else:
        db.add(Setting(key=key, value=value))
    await db.commit()


async def _get(db: AsyncSession, key: str) -> dict:
    s = await db.get(Setting, key)
    return dict(s.value) if s else {}


# ---------------- Overblik ----------------
@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    day_end = now + timedelta(hours=24)
    return {
        "open_tasks": await db.scalar(select(func.count()).select_from(Task).where(Task.status != "done")),
        "overdue_tasks": await db.scalar(select(func.count()).select_from(Task).where(Task.status != "done",
                                                                                       Task.due_at < now)),
        "events_next_24h": await db.scalar(select(func.count()).select_from(CalendarEvent)
                                           .where(CalendarEvent.start >= now, CalendarEvent.start < day_end)),
        "pending_approvals": await db.scalar(select(func.count()).select_from(Approval).where(Approval.status == "pending")),
        "memories": await db.scalar(select(func.count()).select_from(Memory).where(Memory.superseded_by.is_(None))),
        "unread_notifications": await db.scalar(select(func.count()).select_from(Notification)
                                                .where(Notification.read.is_(False))),
        "cloud_spent_month_dkk": round(await registry.cloud_spent_this_month(db), 2),
    }


# ---------------- Agenter ----------------
@router.get("/agents")
async def list_agents(db: AsyncSession = Depends(get_db)):
    policy = await load_policy(db)
    usage = dict((await db.execute(select(UsageRecord.agent, func.count()).group_by(UsageRecord.agent))).all())
    return [{"key": a.key, "name": a.name, "description": a.description, "tools": a.tools, "tier": a.tier,
             "icon": a.icon, "enabled": a.key not in policy.disabled_agents, "calls": usage.get(a.key, 0)}
            for a in AGENTS.values()]


@router.post("/agents/{key}/toggle")
async def toggle_agent(key: str, enabled: bool, db: AsyncSession = Depends(get_db)):
    if key not in AGENTS:
        raise HTTPException(404)
    p = await _get(db, "policy")
    disabled = set(p.get("disabled_agents", []))
    (disabled.discard if enabled else disabled.add)(key)
    p["disabled_agents"] = sorted(disabled)
    await _set(db, "policy", p)
    await audit(db, "user", "security.agent_toggle", key, details={"enabled": enabled})
    return {"key": key, "enabled": enabled}


# ---------------- Sikkerhedspolitik (kun via brugerens login – aldrig via AI-værktøjer) ----------------
class PolicyIn(BaseModel):
    auto_allow_max: int = int(Risk.WRITE_LOCAL)
    disabled_tools: list[str] = []


@router.get("/security/policy")
async def get_policy(db: AsyncSession = Depends(get_db)):
    p = await load_policy(db)
    return {"auto_allow_max": int(p.auto_allow_max), "disabled_tools": sorted(p.disabled_tools),
            "disabled_agents": sorted(p.disabled_agents),
            "tools": [{"name": t.name, "risk": int(t.risk), "risk_name": t.risk.name, "description": t.description}
                      for t in tools.tools.values()],
            "levels": {r.name: int(r) for r in Risk}}


@router.put("/security/policy")
async def put_policy(body: PolicyIn, db: AsyncSession = Depends(get_db)):
    if body.auto_allow_max > Risk.MODIFY:
        raise HTTPException(400, "Eksterne og væsentlige handlinger kræver altid godkendelse")
    p = await _get(db, "policy")
    p.update(auto_allow_max=body.auto_allow_max, disabled_tools=sorted(set(body.disabled_tools) & set(tools.tools)))
    await _set(db, "policy", p)
    await audit(db, "user", "security.policy_update", details=p)
    return p


@router.get("/security/audit")
async def audit_log(limit: int = 200, action: str = "", db: AsyncSession = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.id.desc())
    if action:
        q = q.where(AuditLog.action.ilike(f"%{action}%"))
    return [{"id": a.id, "ts": a.ts, "actor": a.actor, "action": a.action, "target": a.target, "decision": a.decision,
             "details": a.details, "ip": a.ip} for a in (await db.scalars(q.limit(min(limit, 1000)))).all()]


# ---------------- Godkendelser ----------------
@router.get("/approvals")
async def list_approvals(status: str = "pending", db: AsyncSession = Depends(get_db)):
    q = select(Approval).order_by(Approval.id.desc())
    if status != "all":
        q = q.where(Approval.status == status)
    return [{"id": a.id, "agent": a.agent, "tool": a.tool, "args": a.args, "risk": a.risk,
             "risk_name": Risk(a.risk).name, "reason": a.reason, "summary": a.summary, "status": a.status,
             "result": a.result, "created_at": a.created_at, "conversation_id": a.conversation_id}
            for a in (await db.scalars(q.limit(200))).all()]


@router.post("/approvals/{aid}/approve")
async def approve(aid: int, db: AsyncSession = Depends(get_db)):
    a = await db.get(Approval, aid)
    if not a or a.status != "pending":
        raise HTTPException(400, "Godkendelsen findes ikke eller er allerede behandlet")
    a.status = "approved"
    await audit(db, "user", "approval.approve", f"#{aid} {a.tool}")
    return await execute_approval(db, a)


@router.post("/approvals/{aid}/reject")
async def reject(aid: int, db: AsyncSession = Depends(get_db)):
    a = await db.get(Approval, aid)
    if not a or a.status != "pending":
        raise HTTPException(400, "Godkendelsen findes ikke eller er allerede behandlet")
    a.status, a.decided_at = "rejected", datetime.now(timezone.utc)
    await audit(db, "user", "approval.reject", f"#{aid} {a.tool}")
    return {"ok": True}


# ---------------- Modeller ----------------
class ModelIn(BaseModel):
    provider: str
    model: str
    label: str = ""
    tier: str = "local_small"
    enabled: bool = True
    context_window: int = 8192
    cost_in_dkk_per_mtok: float = 0
    cost_out_dkk_per_mtok: float = 0
    base_url: str = ""
    secret_name: str = ""
    capabilities: list[str] = []


class SecretIn(BaseModel):
    name: str
    value: str


class ModelPrefs(BaseModel):
    prefer_cloud: bool = False
    cloud_budget_dkk: float = 400
    default_model: str | None = None


def _model(m: ModelConfig) -> dict:
    return {c.name: getattr(m, c.name) for c in ModelConfig.__table__.columns}


@router.get("/models")
async def list_models(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(ModelConfig).order_by(ModelConfig.tier, ModelConfig.id))).all()
    specs = await registry.specs(db)
    avail = await registry.available(specs)
    return {"models": [{**_model(m), "available": f"{m.provider}:{m.model}" in avail} for m in rows],
            "preferences": await _get(db, "models"),
            "providers": ["ollama", "openai", "anthropic", "openai_compatible"],
            "tiers": ["local_small", "local_large", "local_code", "cloud"]}


@router.post("/models")
async def add_model(body: ModelIn, db: AsyncSession = Depends(get_db)):
    if body.provider not in ("ollama", "openai", "anthropic", "openai_compatible"):
        raise HTTPException(400, "Ukendt udbyder")
    m = ModelConfig(**body.model_dump())
    db.add(m)
    await db.commit()
    await audit(db, "user", "models.add", f"{m.provider}:{m.model}")
    return _model(m)


@router.patch("/models/{mid}")
async def update_model(mid: int, body: dict, db: AsyncSession = Depends(get_db)):
    m = await db.get(ModelConfig, mid)
    if not m:
        raise HTTPException(404)
    for k, v in body.items():
        if k in ModelIn.model_fields:
            setattr(m, k, v)
    await db.commit()
    return _model(m)


@router.delete("/models/{mid}")
async def delete_model(mid: int, db: AsyncSession = Depends(get_db)):
    m = await db.get(ModelConfig, mid)
    if m:
        await db.delete(m)
        await db.commit()
    return {"ok": True}


@router.put("/models/preferences")
async def set_prefs(body: ModelPrefs, db: AsyncSession = Depends(get_db)):
    await _set(db, "models", body.model_dump())
    return body


@router.get("/models/ollama")
async def ollama_models():
    try:
        return await ollama.list_models()
    except Exception as e:
        raise HTTPException(502, f"Ollama svarer ikke: {e}")


@router.post("/models/ollama/pull")
async def ollama_pull(model: str):
    async def gen():
        async for line in ollama.pull(model):
            yield json.dumps(line) + "\n"
    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.get("/models/usage")
async def usage(days: int = 30, db: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(select(UsageRecord.provider, UsageRecord.model, func.count(), func.sum(UsageRecord.tokens_in),
                                    func.sum(UsageRecord.tokens_out), func.sum(UsageRecord.cost_dkk))
                             .where(UsageRecord.ts >= since).group_by(UsageRecord.provider, UsageRecord.model))).all()
    return [{"provider": p, "model": m, "calls": c, "tokens_in": ti or 0, "tokens_out": to or 0,
             "cost_dkk": round(cost or 0, 2)} for p, m, c, ti, to, cost in rows]


@router.get("/secrets")
async def list_secrets(db: AsyncSession = Depends(get_db)):
    vault = SecretVault(get_settings().master_key)
    return [{"name": s.name, "masked": vault.mask(vault.decrypt(s.ciphertext)), "updated_at": s.updated_at}
            for s in (await db.scalars(select(Secret))).all()]


@router.put("/secrets")
async def put_secret(body: SecretIn, db: AsyncSession = Depends(get_db)):
    vault = SecretVault(get_settings().master_key)
    s = await db.scalar(select(Secret).where(Secret.name == body.name))
    if s:
        s.ciphertext = vault.encrypt(body.value)
    else:
        db.add(Secret(name=body.name, ciphertext=vault.encrypt(body.value)))
    await db.commit()
    await audit(db, "user", "security.secret_set", body.name)
    return {"name": body.name, "masked": vault.mask(body.value)}


@router.delete("/secrets/{name}")
async def delete_secret(name: str, db: AsyncSession = Depends(get_db)):
    s = await db.scalar(select(Secret).where(Secret.name == name))
    if s:
        await db.delete(s)
        await db.commit()
        await audit(db, "user", "security.secret_delete", name)
    return {"ok": True}


# ---------------- Automatiseringer ----------------
class AutomationIn(BaseModel):
    name: str
    kind: str
    cron: str
    config: dict = {}
    enabled: bool = True


def _auto(a: Automation) -> dict:
    job = auto.scheduler.get_job(f"automation-{a.id}") if auto.scheduler.running else None
    return {"id": a.id, "name": a.name, "kind": a.kind, "cron": a.cron, "config": a.config, "enabled": a.enabled,
            "last_run_at": a.last_run_at, "last_status": a.last_status, "last_output": a.last_output,
            "next_run_at": job.next_run_time if job else None}


@router.get("/automations")
async def list_automations(db: AsyncSession = Depends(get_db)):
    return {"kinds": auto.KINDS, "items": [_auto(a) for a in (await db.scalars(select(Automation).order_by(Automation.id))).all()]}


@router.post("/automations")
async def create_automation(body: AutomationIn, db: AsyncSession = Depends(get_db)):
    if body.kind not in auto.KINDS:
        raise HTTPException(400, "Ukendt type")
    try:
        auto.validate_cron(body.cron)
    except ValueError as e:
        raise HTTPException(400, f"Ugyldigt cron-udtryk: {e}")
    a = Automation(**body.model_dump())
    db.add(a)
    await db.commit()
    auto.schedule(a)
    await audit(db, "user", "automation.create", a.name, details=body.model_dump())
    return _auto(a)


@router.put("/automations/{aid}")
async def update_automation(aid: int, body: AutomationIn, db: AsyncSession = Depends(get_db)):
    a = await db.get(Automation, aid)
    if not a:
        raise HTTPException(404)
    try:
        auto.validate_cron(body.cron)
    except ValueError as e:
        raise HTTPException(400, f"Ugyldigt cron-udtryk: {e}")
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    await db.commit()
    auto.schedule(a)
    return _auto(a)


@router.delete("/automations/{aid}")
async def delete_automation(aid: int, db: AsyncSession = Depends(get_db)):
    a = await db.get(Automation, aid)
    if a:
        auto.unschedule(aid)
        await db.delete(a)
        await db.commit()
    return {"ok": True}


@router.post("/automations/{aid}/run")
async def run_now(aid: int):
    await auto.run_automation(aid)
    return {"ok": True}


@router.get("/automations/{aid}/runs")
async def runs(aid: int, db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(AutomationRun).where(AutomationRun.automation_id == aid)
                             .order_by(AutomationRun.id.desc()).limit(50))).all()
    return [{"id": r.id, "started_at": r.started_at, "finished_at": r.finished_at, "status": r.status,
             "output": r.output[:3000]} for r in rows]


# ---------------- Notifikationer ----------------
@router.get("/notifications")
async def notifications(unread: bool = False, db: AsyncSession = Depends(get_db)):
    q = select(Notification).order_by(Notification.id.desc())
    if unread:
        q = q.where(Notification.read.is_(False))
    return [{"id": n.id, "ts": n.ts, "title": n.title, "body": n.body, "level": n.level, "read": n.read, "link": n.link}
            for n in (await db.scalars(q.limit(100))).all()]


@router.post("/notifications/read-all")
async def read_all(db: AsyncSession = Depends(get_db)):
    await db.execute(Notification.__table__.update().values(read=True))
    await db.commit()
    return {"ok": True}


# ---------------- Backup ----------------
@router.get("/backups")
async def backups():
    return backup.list_backups()


@router.post("/backups")
async def create_backup(db: AsyncSession = Depends(get_db)):
    try:
        res = await backup.run_backup()
    except Exception as e:
        raise HTTPException(500, str(e))
    await audit(db, "user", "backup.create", res["file"])
    return res


# ---------------- Stemme ----------------
@router.post("/voice/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("da")):
    data = await audio.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(400, "Lydfilen er for stor")
    try:
        return await voice.transcribe(data, None if language == "auto" else language)
    except Exception as e:
        raise HTTPException(500, f"Talegenkendelse fejlede: {e}")


class SpeakIn(BaseModel):
    text: str
    lang: str = "da"


@router.post("/voice/speak")
async def speak(body: SpeakIn):
    try:
        audio, mime = await voice.synthesize(body.text, body.lang)
    except Exception as e:
        raise HTTPException(500, str(e))
    return Response(audio, media_type=mime)


@router.get("/voice/status")
async def voice_status():
    return voice.voice_status()


# ---------------- Genindeksering (efter gendannelse eller skift af embedding-model) ----------------
@router.post("/maintenance/reindex")
async def reindex(db: AsyncSession = Depends(get_db)):
    from pathlib import Path

    from app.documents.parsers import chunk_text, parse_bytes
    from app.db.models import Document
    from app.memory.vectorstore import point_id, vectors
    await vectors.ensure_collections()
    mems = (await db.scalars(select(Memory).where(Memory.superseded_by.is_(None)))).all()
    for i in range(0, len(mems), 64):
        await vectors.upsert("memories", [(point_id("memory", m.id), m.content,
                                           {"memory_id": m.id, "kind": m.kind, "tier": m.tier}) for m in mems[i:i + 64]])
    docs_done = 0
    for d in (await db.scalars(select(Document))).all():
        p = Path(d.path)
        if not p.exists():
            continue
        chunks = chunk_text(parse_bytes(p.read_bytes(), d.mime, d.filename))
        for i in range(0, len(chunks), 64):
            await vectors.upsert("documents", [(point_id("doc", f"{d.id}:{j}"), c, {"document_id": d.id, "chunk": j,
                                                                                    "filename": d.filename})
                                               for j, c in enumerate(chunks[i:i + 64], start=i)])
        d.chunk_count, d.status = len(chunks), "ready"
        docs_done += 1
    await db.commit()
    await audit(db, "user", "maintenance.reindex", details={"memories": len(mems), "documents": docs_done})
    return {"memories": len(mems), "documents": docs_done}
