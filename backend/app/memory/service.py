"""Hukommelsessystem: lagring, søgning, automatisk udtræk, konsolidering og oprydning."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Memory, Message
from app.memory import scoring
from app.memory.vectorstore import point_id, vectors

log = logging.getLogger("jarvis.memory")


class MemoryService:
    async def add(self, db: AsyncSession, kind: str, content: str, importance: float = 0.5, *,
                  tags: list[str] | None = None, conversation_id: int | None = None,
                  project_id: int | None = None, tier: str | None = None, pinned: bool = False) -> Memory:
        now = datetime.now(timezone.utc)
        tier = tier or scoring.initial_tier(kind, importance)
        m = Memory(kind=kind, content=content, importance=importance, tags=tags or [], tier=tier,
                   source_conversation_id=conversation_id, project_id=project_id, pinned=pinned,
                   expires_at=None if tier == "long" else now + scoring.SHORT_TTL)
        db.add(m)
        await db.commit()
        await db.refresh(m)
        await self._index(m)
        return m

    async def _index(self, m: Memory) -> None:
        try:
            await vectors.upsert("memories", [(point_id("memory", m.id), m.content,
                                               {"memory_id": m.id, "kind": m.kind, "tier": m.tier})])
        except Exception as e:  # Qdrant/Ollama nede: hukommelsen gemmes stadig i Postgres
            log.warning("Kunne ikke indeksere minde %s: %s", m.id, e)

    async def update(self, db: AsyncSession, memory_id: int, **fields) -> Memory | None:
        m = await db.get(Memory, memory_id)
        if not m:
            return None
        for k, v in fields.items():
            if v is not None and hasattr(m, k):
                setattr(m, k, v)
        if fields.get("tier") == "long":
            m.expires_at = None
        await db.commit()
        await self._index(m)
        return m

    async def delete(self, db: AsyncSession, memory_id: int) -> bool:
        m = await db.get(Memory, memory_id)
        if not m:
            return False
        await db.delete(m)
        await db.commit()
        try:
            await vectors.delete("memories", ids=[point_id("memory", memory_id)])
        except Exception as e:
            log.warning("Vektor for minde %s blev ikke slettet: %s", memory_id, e)
        return True

    async def search(self, db: AsyncSession, query: str, limit: int = 8, kind: str | None = None) -> list[Memory]:
        """Semantisk søgning med fallback til tekstsøgning hvis vektordatabasen ikke svarer."""
        try:
            hits = await vectors.search("memories", query, limit=limit * 3, flt={"kind": kind} if kind else None)
        except Exception as e:
            log.warning("Vektorsøgning fejlede, bruger tekstsøgning: %s", e)
            q = select(Memory).where(Memory.content.ilike(f"%{query[:100]}%"), Memory.superseded_by.is_(None))
            if kind:
                q = q.where(Memory.kind == kind)
            return list((await db.scalars(q.limit(limit))).all())
        sims = {int(h["memory_id"]): h["score"] for h in hits if "memory_id" in h}
        if not sims:
            return []
        rows = (await db.scalars(select(Memory).where(Memory.id.in_(list(sims)), Memory.superseded_by.is_(None)))).all()
        ranked = sorted(rows, key=lambda m: scoring.rank_score(scoring.Candidate(
            m.id, sims[m.id], m.importance, m.tier, m.last_accessed, m.created_at, m.pinned)), reverse=True)[:limit]
        now = datetime.now(timezone.utc)
        for m in ranked:
            m.access_count += 1
            m.last_accessed = now
            if m.tier == "short" and scoring.should_promote(m.importance, m.access_count, m.kind):
                m.tier, m.expires_at = "long", None
        await db.commit()
        return ranked

    async def context_block(self, db: AsyncSession, query: str, limit: int = 8) -> str:
        """Tekstblok der indsættes i systemprompten, så assistenten bruger relevante minder aktivt."""
        pinned = (await db.scalars(select(Memory).where(Memory.pinned.is_(True), Memory.superseded_by.is_(None))
                                   .limit(10))).all()
        found = await self.search(db, query, limit=limit)
        seen, lines = set(), []
        for m in [*pinned, *found]:
            if m.id in seen:
                continue
            seen.add(m.id)
            lines.append(f"- [{m.kind}#{m.id}] {m.content}")
        return ("Relevante ting du husker om brugeren:\n" + "\n".join(lines)) if lines else ""

    async def extract_from_conversation(self, db: AsyncSession, conversation_id: int, llm_call) -> list[Memory]:
        """Kaldes efter hver samtaletur. llm_call(prompt)->str bruger en billig lokal model."""
        msgs = (await db.scalars(select(Message).where(Message.conversation_id == conversation_id)
                                 .order_by(Message.id.desc()).limit(6))).all()
        msgs = list(reversed(msgs))
        dialogue = "\n".join(f"{m.role.upper()}: {m.content[:1500]}" for m in msgs if m.role in ("user", "assistant"))
        if not dialogue.strip():
            return []
        last_user = next((m.content for m in reversed(msgs) if m.role == "user"), "")
        existing = await self.search(db, last_user, limit=6) if last_user else []
        ex_txt = "\n".join(f"#{m.id} ({m.kind}): {m.content}" for m in existing) or "(ingen)"
        raw = await llm_call(scoring.EXTRACTION_PROMPT.format(existing=ex_txt, dialogue=dialogue))
        created = []
        for item in scoring.parse_extraction(raw):
            new = await self.add(db, item["kind"], item["content"], item["importance"], tags=item["tags"],
                                 conversation_id=conversation_id)
            if item["replaces"]:
                await db.execute(update(Memory).where(Memory.id == item["replaces"]).values(superseded_by=new.id))
                await db.commit()
            created.append(new)
        return created

    async def maintenance(self, db: AsyncSession) -> dict:
        """Daglig oprydning: slet udløbet korttidshukommelse og erstattede minder ældre end 30 dage."""
        now = datetime.now(timezone.utc)
        expired = (await db.scalars(select(Memory.id).where(Memory.tier == "short", Memory.expires_at < now,
                                                             Memory.pinned.is_(False)))).all()
        if expired:
            await db.execute(delete(Memory).where(Memory.id.in_(expired)))
            await db.commit()
            try:
                await vectors.delete("memories", ids=[point_id("memory", i) for i in expired])
            except Exception:
                pass
        return {"expired_removed": len(expired)}


memory_service = MemoryService()
