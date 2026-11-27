from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db.models import Conversation, Message
from app.db.session import SessionLocal, get_db
from app.services import assistant

router = APIRouter(prefix="/api/conversations", tags=["chat"], dependencies=[Depends(current_user)])


class ConversationIn(BaseModel):
    title: str = "Ny samtale"
    agent: str = "main"
    project_id: int | None = None


class ChatIn(BaseModel):
    message: str
    agent: str | None = None
    model: str | None = None  # "provider:model" for manuelt valg


@router.get("")
async def list_conversations(archived: bool = False, q: str = "", db: AsyncSession = Depends(get_db)):
    stmt = select(Conversation).where(Conversation.archived.is_(archived)).order_by(Conversation.updated_at.desc())
    if q:
        stmt = stmt.where(Conversation.title.ilike(f"%{q}%"))
    return [{"id": c.id, "title": c.title, "agent": c.agent, "updated_at": c.updated_at, "project_id": c.project_id}
            for c in (await db.scalars(stmt.limit(200))).all()]


@router.post("")
async def create_conversation(body: ConversationIn, db: AsyncSession = Depends(get_db)):
    c = Conversation(title=body.title, agent=body.agent, project_id=body.project_id)
    db.add(c)
    await db.commit()
    return {"id": c.id, "title": c.title, "agent": c.agent}


@router.get("/{cid}")
async def get_conversation(cid: int, db: AsyncSession = Depends(get_db)):
    c = await db.get(Conversation, cid)
    if not c:
        raise HTTPException(404, "Samtalen findes ikke")
    msgs = (await db.scalars(select(Message).where(Message.conversation_id == cid).order_by(Message.id))).all()
    return {"id": c.id, "title": c.title, "agent": c.agent,
            "messages": [{"id": m.id, "role": m.role, "content": m.content, "agent": m.agent, "model": m.model,
                          "meta": m.meta, "created_at": m.created_at} for m in msgs]}


@router.patch("/{cid}")
async def update_conversation(cid: int, body: dict, db: AsyncSession = Depends(get_db)):
    c = await db.get(Conversation, cid)
    if not c:
        raise HTTPException(404)
    for k in ("title", "archived", "agent", "project_id"):
        if k in body:
            setattr(c, k, body[k])
    await db.commit()
    return {"ok": True}


@router.delete("/{cid}")
async def delete_conversation(cid: int, db: AsyncSession = Depends(get_db)):
    c = await db.get(Conversation, cid)
    if c:
        await db.delete(c)
        await db.commit()
    return {"ok": True}


@router.post("/{cid}/messages", summary="Send besked – svar streames som Server-Sent Events")
async def send_message(cid: int, body: ChatIn):
    if not body.message.strip():
        raise HTTPException(400, "Tom besked")

    async def gen():
        # Egen session, da streamen lever længere end request-dependency
        async with SessionLocal() as db:
            conv = await db.get(Conversation, cid)
            if not conv:
                yield f"event: error\ndata: {json.dumps({'message': 'Samtalen findes ikke'})}\n\n"
                return
            async for ev in assistant.chat(db, conv, body.message, agent=body.agent, model=body.model):
                yield f"event: {ev.type}\ndata: {json.dumps(ev.data, ensure_ascii=False, default=str)}\n\n"
            yield "event: end\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
