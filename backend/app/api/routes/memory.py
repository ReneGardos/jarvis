from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db.models import Memory
from app.db.session import get_db
from app.memory.scoring import KINDS
from app.memory.service import memory_service
from app.services.audit import audit

router = APIRouter(prefix="/api/memory", tags=["memory"], dependencies=[Depends(current_user)])


class MemoryIn(BaseModel):
    kind: str = "fact"
    content: str = Field(min_length=3, max_length=1000)
    importance: float = Field(0.6, ge=0, le=1)
    tags: list[str] = []
    pinned: bool = False
    tier: str | None = None


class MemoryPatch(BaseModel):
    content: str | None = None
    kind: str | None = None
    importance: float | None = None
    tier: str | None = None
    pinned: bool | None = None
    tags: list[str] | None = None


def _out(m: Memory) -> dict:
    return {"id": m.id, "kind": m.kind, "content": m.content, "tier": m.tier, "importance": m.importance,
            "access_count": m.access_count, "pinned": m.pinned, "tags": m.tags, "created_at": m.created_at,
            "updated_at": m.updated_at, "expires_at": m.expires_at, "source_conversation_id": m.source_conversation_id}


@router.get("")
async def list_memories(kind: str | None = None, tier: str | None = None, q: str = "", limit: int = 200,
                        db: AsyncSession = Depends(get_db)):
    if q:
        return [_out(m) for m in await memory_service.search(db, q, limit=min(limit, 50), kind=kind)]
    stmt = select(Memory).where(Memory.superseded_by.is_(None)).order_by(Memory.pinned.desc(), Memory.updated_at.desc())
    if kind:
        stmt = stmt.where(Memory.kind == kind)
    if tier:
        stmt = stmt.where(Memory.tier == tier)
    return [_out(m) for m in (await db.scalars(stmt.limit(limit))).all()]


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Memory.kind, Memory.tier, func.count()).where(Memory.superseded_by.is_(None))
                             .group_by(Memory.kind, Memory.tier))).all()
    return [{"kind": k, "tier": t, "count": c} for k, t, c in rows]


@router.post("")
async def create(body: MemoryIn, db: AsyncSession = Depends(get_db)):
    if body.kind not in KINDS:
        raise HTTPException(400, f"kind skal være en af {sorted(KINDS)}")
    m = await memory_service.add(db, body.kind, body.content, body.importance, tags=body.tags, pinned=body.pinned,
                                 tier=body.tier)
    await audit(db, "user", "memory.create", str(m.id))
    return _out(m)


@router.patch("/{mid}")
async def patch(mid: int, body: MemoryPatch, db: AsyncSession = Depends(get_db)):
    m = await memory_service.update(db, mid, **body.model_dump(exclude_none=True))
    if not m:
        raise HTTPException(404, "Mindet findes ikke")
    await audit(db, "user", "memory.update", str(mid))
    return _out(m)


@router.delete("/{mid}")
async def delete(mid: int, db: AsyncSession = Depends(get_db)):
    if not await memory_service.delete(db, mid):
        raise HTTPException(404, "Mindet findes ikke")
    await audit(db, "user", "memory.delete", str(mid))
    return {"ok": True}
