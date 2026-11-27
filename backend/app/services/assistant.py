"""Binder orkestrator, modelregister, hukommelse, policy og godkendelser sammen."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import Event, Orchestrator
from app.core.policy import PolicyConfig, Risk
from app.db.models import Approval, Conversation, Message, Setting
from app.db.session import SessionLocal
from app.llm.registry import PROVIDERS, registry
from app.memory.service import memory_service
from app.services.audit import audit
from app.tools import builtin  # noqa: F401  (registrerer værktøjer)
from app.tools.framework import Tool, ToolContext
from app.tools.framework import registry as tools

log = logging.getLogger("jarvis.assistant")


async def load_policy(db: AsyncSession) -> PolicyConfig:
    s = await db.get(Setting, "policy")
    v = s.value if s else {}
    return PolicyConfig(auto_allow_max=Risk(min(int(v.get("auto_allow_max", Risk.WRITE_LOCAL)), Risk.MODIFY)),
                        disabled_agents=set(v.get("disabled_agents", [])),
                        disabled_tools=set(v.get("disabled_tools", [])))


def make_llm(db: AsyncSession, forced_model: str | None, agent_name: str = ""):
    async def llm(messages: list[dict], tier: str | None, json_mode: bool) -> str:
        text = messages[-1]["content"]
        decision = await registry.route(db, text, forced=forced_model if not json_mode else None,
                                        history_len=len(messages), tier=tier)
        res = await registry.chat(db, decision.spec, messages, agent=agent_name, json_mode=json_mode,
                                  temperature=0.1 if json_mode else 0.4, max_tokens=3000)
        return res.text

    async def stream(messages: list[dict], tier: str | None) -> AsyncIterator[str]:
        decision = await registry.route(db, messages[-1]["content"], forced=forced_model, history_len=len(messages),
                                        tier=tier)
        stream.last_model = f"{decision.spec.provider}:{decision.spec.model}"  # type: ignore[attr-defined]
        async for ch in PROVIDERS[decision.spec.provider].stream(decision.spec, messages):
            if ch.done:
                await registry.record_usage(db, decision.spec, ch.tokens_in, ch.tokens_out, agent_name)
            elif ch.delta:
                yield ch.delta
    return llm, stream


def approval_requester(db: AsyncSession):
    async def request(ctx: ToolContext, tool: Tool, args: dict, reason: str) -> int:
        summary = tool.summary(args) if tool.summary else f"{tool.name}({args})"
        a = Approval(agent=ctx.agent, tool=tool.name, args=args, risk=int(tool.risk), reason=reason,
                     summary=summary[:1000], conversation_id=ctx.conversation_id)
        db.add(a)
        await db.commit()
        from app.services.notify import notify
        await notify(db, "Jarvis beder om godkendelse", summary, level="warning", link="/approvals")
        return a.id
    return request


def auditor(db: AsyncSession):
    async def _a(**kw):
        await audit(db, **kw)
    return _a


async def execute_approval(db: AsyncSession, approval: Approval) -> dict:
    """Udføres når brugeren har godkendt. Kører som brugerhandling (policy tillader det)."""
    ctx = ToolContext(actor="user", agent=approval.agent, conversation_id=approval.conversation_id, db=db,
                      policy=await load_policy(db), audit=auditor(db))
    result = await tools.execute(ctx, approval.tool, approval.args)
    approval.status = "executed" if result.get("ok") else "failed"
    approval.result = result
    approval.decided_at = datetime.now(timezone.utc)
    await db.commit()
    if approval.conversation_id:
        db.add(Message(conversation_id=approval.conversation_id, role="system", agent=approval.agent,
                       content=f"Godkendt handling #{approval.id} ({approval.summary}) → "
                               f"{'udført' if result.get('ok') else 'fejlede: ' + str(result.get('error'))}"))
        await db.commit()
    return result


async def chat(db: AsyncSession, conversation: Conversation, user_text: str, *, agent: str | None = None,
               model: str | None = None) -> AsyncIterator[Event]:
    db.add(Message(conversation_id=conversation.id, role="user", content=user_text))
    await db.commit()
    rows = (await db.scalars(select(Message).where(Message.conversation_id == conversation.id)
                             .order_by(Message.id.desc()).limit(31))).all()
    history = [{"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
               for m in reversed(rows[1:])]
    try:
        memory_block = await memory_service.context_block(db, user_text)
    except Exception as e:
        log.warning("Hukommelse utilgængelig: %s", e)
        memory_block = ""
    policy = await load_policy(db)
    ctx = ToolContext(actor="agent", agent="main", conversation_id=conversation.id, policy=policy, db=db,
                      request_approval=approval_requester(db), audit=auditor(db))
    llm, stream = make_llm(db, model, agent or "main")
    orch = Orchestrator(tools, llm, stream)
    answer, meta = [], {"tools": [], "agents": [], "approvals": []}
    try:
        async for ev in orch.handle(user_text, history, ctx, memory_block=memory_block, agent=agent or conversation.agent,
                                    disabled_agents=policy.disabled_agents):
            if ev.type == "token":
                answer.append(ev.data["text"])
            elif ev.type == "tool_call":
                meta["tools"].append({"tool": ev.data["tool"], "agent": ev.data["agent"]})
            elif ev.type == "done":
                meta["agents"], meta["approvals"] = ev.data["agents"], ev.data["approvals"]
            yield ev
    except Exception as e:
        log.exception("Chat fejlede")
        yield Event("error", {"message": str(e)})
        answer.append(f"\n\n⚠️ Fejl: {e}")
    meta["sources"] = ctx.sources
    meta["model"] = getattr(stream, "last_model", "")
    meta["tainted"] = ctx.tainted
    text = "".join(answer).strip()
    db.add(Message(conversation_id=conversation.id, role="assistant", content=text or "(intet svar)",
                   agent=",".join(meta["agents"]) or "main", model=meta["model"], meta=meta))
    if conversation.title == "Ny samtale":
        conversation.title = user_text[:60] + ("…" if len(user_text) > 60 else "")
    await db.commit()
    yield Event("sources", {"sources": ctx.sources})
    task = asyncio.create_task(_extract_memories(conversation.id))
    _background.add(task)
    task.add_done_callback(_background.discard)


_background: set[asyncio.Task] = set()


async def _extract_memories(conversation_id: int) -> None:
    """Kører i baggrunden med egen session og billigste lokale model."""
    async with SessionLocal() as db:
        try:
            async def call(prompt: str) -> str:
                d = await registry.route(db, "kort", tier="local_small")
                if not d.spec.is_local:
                    return '{"memories": []}'  # brug ikke cloudbudget på baggrundsarbejde
                return (await registry.chat(db, d.spec, [{"role": "user", "content": prompt}], agent="memory",
                                            json_mode=True, temperature=0.1)).text
            await memory_service.extract_from_conversation(db, conversation_id, call)
        except Exception as e:
            log.warning("Hukommelsesudtræk fejlede: %s", e)
