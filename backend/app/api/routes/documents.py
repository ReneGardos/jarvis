"""Dokumenter, internet research og programmering."""
from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.definitions import AGENTS
from app.agents.runtime import run_agent
from app.api.deps import current_user
from app.core.config import get_settings
from app.db.models import Document, ResearchItem
from app.db.session import get_db
from app.documents import service as docs
from app.documents.parsers import parse_bytes
from app.services.assistant import approval_requester, auditor, load_policy, make_llm
from app.tools.builtin import sandbox
from app.tools.framework import ToolContext
from app.tools.framework import registry as tools

router = APIRouter(prefix="/api", tags=["documents"], dependencies=[Depends(current_user)])


def _doc(d: Document) -> dict:
    return {"id": d.id, "filename": d.filename, "mime": d.mime, "size": d.size, "folder": d.folder, "tags": d.tags,
            "status": d.status, "chunk_count": d.chunk_count, "summary": d.summary, "created_at": d.created_at,
            "project_id": d.project_id}


@router.get("/documents")
async def list_documents(folder: str | None = None, db: AsyncSession = Depends(get_db)):
    q = select(Document).order_by(Document.created_at.desc())
    if folder:
        q = q.where(Document.folder == folder)
    return [_doc(d) for d in (await db.scalars(q.limit(500))).all()]


@router.post("/documents")
async def upload(file: UploadFile = File(...), folder: str = Form(""), project_id: int | None = Form(None),
                 db: AsyncSession = Depends(get_db)):
    data = await file.read()
    existing = await db.scalar(select(Document).where(Document.sha256 == hashlib.sha256(data).hexdigest()))
    if existing:
        return {**_doc(existing), "duplicate": True}
    try:
        d = await docs.ingest(db, file.filename or "fil", data, file.content_type or "", folder, project_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _doc(d)


@router.get("/documents/{did}")
async def get_document(did: int, db: AsyncSession = Depends(get_db)):
    d = await db.get(Document, did)
    if not d:
        raise HTTPException(404)
    return {**_doc(d), "text_preview": d.text_preview}


@router.patch("/documents/{did}")
async def patch_document(did: int, body: dict, db: AsyncSession = Depends(get_db)):
    d = await db.get(Document, did)
    if not d:
        raise HTTPException(404)
    for k in ("folder", "tags", "project_id", "filename"):
        if k in body:
            setattr(d, k, body[k])
    await db.commit()
    return _doc(d)


@router.get("/documents/{did}/download")
async def download(did: int, db: AsyncSession = Depends(get_db)):
    d = await db.get(Document, did)
    if not d or not Path(d.path).exists():
        raise HTTPException(404)
    # Sikrer at stien ligger i upload-mappen
    if get_settings().upload_dir.resolve() not in Path(d.path).resolve().parents:
        raise HTTPException(403)
    return FileResponse(d.path, filename=d.filename)


@router.delete("/documents/{did}")
async def delete_document(did: int, db: AsyncSession = Depends(get_db)):
    d = await db.get(Document, did)
    if d:
        await docs.remove(db, d)
    return {"ok": True}


@router.get("/documents-search")
async def search_documents(q: str, document_id: int | None = None):
    return await docs.search(q, limit=10, document_id=document_id)


@router.post("/documents/{did}/summarize")
async def summarize(did: int, db: AsyncSession = Depends(get_db)):
    d = await db.get(Document, did)
    if not d:
        raise HTTPException(404)
    llm, _ = make_llm(db, None, "document")
    from app.core.injection import wrap_untrusted
    text = parse_bytes(Path(d.path).read_bytes(), d.mime, d.filename)[:24000]
    wrapped, _ = wrap_untrusted(text, d.filename)
    d.summary = await llm([{"role": "system", "content": AGENTS["document"].system},
                           {"role": "user", "content": f"Lav et præcist resumé på dansk med hovedpunkter, "
                                                       f"nøgletal og evt. deadlines:\n{wrapped}"}], "local_large", False)
    await db.commit()
    return {"summary": d.summary}


# ---------------- Research ----------------
class ResearchIn(BaseModel):
    query: str
    project_id: int | None = None
    depth: str = "normal"  # normal / deep


@router.post("/research")
async def research(body: ResearchIn, db: AsyncSession = Depends(get_db)):
    agent = AGENTS["research"]
    policy = await load_policy(db)
    if "research" in policy.disabled_agents:
        raise HTTPException(403, "Research-agenten er deaktiveret")
    ctx = ToolContext(agent="research", db=db, policy=policy, request_approval=approval_requester(db), audit=auditor(db))
    llm, _ = make_llm(db, None, "research")
    prompt = (f"Undersøg grundigt: {body.query}\n\nLav en struktureret rapport på dansk med: resumé, vigtigste fund, "
              f"sammenligning hvis relevant, og en kildeliste med URL'er. "
              f"{'Læs mindst 5 kilder.' if body.depth == 'deep' else 'Læs 2-3 gode kilder.'}")
    if body.depth == "deep":
        agent = type(agent)(**{**agent.__dict__, "max_steps": 14})
    result = await run_agent(agent, prompt, [], ctx, tools, llm, disabled_tools=policy.disabled_tools)
    item = ResearchItem(query=body.query, report=result.text, sources=ctx.sources, project_id=body.project_id)
    db.add(item)
    await db.commit()
    return {"id": item.id, "report": item.report, "sources": item.sources, "steps": result.steps}


@router.get("/research")
async def list_research(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(ResearchItem).order_by(ResearchItem.created_at.desc()).limit(100))).all()
    return [{"id": r.id, "query": r.query, "report": r.report, "sources": r.sources, "created_at": r.created_at}
            for r in rows]


@router.delete("/research/{rid}")
async def delete_research(rid: int, db: AsyncSession = Depends(get_db)):
    r = await db.get(ResearchItem, rid)
    if r:
        await db.delete(r)
        await db.commit()
    return {"ok": True}


# ---------------- Programmering (direkte filbrowser) ----------------
@router.get("/workspace/tree")
async def tree(path: str = ".", depth: int = 2):
    try:
        return {"roots": get_settings().workspace_roots, "entries": sandbox.list_dir(path, min(depth, 4))}
    except (PermissionError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))


@router.get("/workspace/file")
async def read_file(path: str):
    try:
        return {"path": path, "content": sandbox.read(path)}
    except (PermissionError, FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))
