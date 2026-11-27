"""Agent-loop og orkestrator. Uafhængig af database og HTTP, så den kan testes med en falsk model."""
from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

from app.agents.definitions import AGENTS, ORCHESTRATOR_PROMPT, AgentDef
from app.core.injection import SYSTEM_GUARD
from app.tools.framework import ToolContext, ToolRegistry, parse_tool_call, tool_instructions

# llm(messages, tier, json_mode) -> tekst ; stream(messages, tier) -> async iterator af tekst
LLMCall = Callable[[list[dict], str | None, bool], Awaitable[str]]
LLMStream = Callable[[list[dict], str | None], AsyncIterator[str]]


@dataclass
class Event:
    type: str            # status / tool_call / tool_result / approval / token / done / error / plan
    data: dict = field(default_factory=dict)


@dataclass
class AgentResult:
    agent: str
    text: str
    steps: list[dict]
    pending_approvals: list[int]


async def run_agent(agent: AgentDef, user_msg: str, history: list[dict], ctx: ToolContext, tools: ToolRegistry,
                    llm: LLMCall, memory_block: str = "", emit: Callable[[Event], Awaitable[None]] | None = None,
                    disabled_tools: set[str] | None = None) -> AgentResult:
    available = [t for t in tools.subset(agent.tools) if t.name not in (disabled_tools or set())]
    system = "\n\n".join(x for x in [agent.system, SYSTEM_GUARD, memory_block, tool_instructions(available)] if x)
    messages = [{"role": "system", "content": system}, *history[-20:], {"role": "user", "content": user_msg}]
    steps, approvals = [], []
    ctx.agent = agent.key
    allowed = {t.name for t in available}
    for _step in range(agent.max_steps):
        reply = await llm(messages, agent.tier, False)
        call = parse_tool_call(reply)
        if not call:
            return AgentResult(agent.key, reply.strip(), steps, approvals)
        name, args = call
        if emit:
            await emit(Event("tool_call", {"agent": agent.key, "tool": name, "args": args}))
        if name not in allowed:
            result = {"ok": False, "error": f"Værktøjet {name} er ikke tilgængeligt for denne agent"}
        else:
            result = await tools.execute(ctx, name, args)
        if result.get("pending_approval"):
            approvals.append(result["pending_approval"])
            if emit:
                await emit(Event("approval", {"id": result["pending_approval"], "tool": name, "args": args}))
        steps.append({"tool": name, "args": args, "ok": result.get("ok"), "error": result.get("error")})
        if emit:
            await emit(Event("tool_result", {"agent": agent.key, "tool": name, "ok": result.get("ok"),
                                             "error": result.get("error")}))
        payload = json.dumps(result, ensure_ascii=False, default=str)[:12000]
        messages += [{"role": "assistant", "content": reply},
                     {"role": "user", "content": f"Værktøjsresultat for {name}:\n{payload}"}]
    messages.append({"role": "user", "content": "Du har brugt alle trin. Giv nu dit bedste endelige svar uden værktøjer."})
    final = await llm(messages, agent.tier, False)
    return AgentResult(agent.key, final.strip(), steps, approvals)


def parse_plan(raw: str, enabled: set[str]) -> dict:
    m = re.search(r"\{.*\}", raw, re.S)
    try:
        plan = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        plan = {}
    mode = plan.get("mode")
    if mode == "single" and plan.get("agent") in enabled:
        return {"mode": "single", "agent": plan["agent"]}
    if mode == "multi":
        tasks = [t for t in plan.get("tasks", []) if isinstance(t, dict) and t.get("agent") in enabled and t.get("task")][:4]
        if len(tasks) == 1:
            return {"mode": "single", "agent": tasks[0]["agent"]}
        if tasks:
            return {"mode": "multi", "tasks": tasks}
    return {"mode": "direct"}


class Orchestrator:
    def __init__(self, tools: ToolRegistry, llm: LLMCall, stream: LLMStream):
        self.tools, self.llm, self.stream = tools, llm, stream

    async def handle(self, user_msg: str, history: list[dict], ctx: ToolContext, *, memory_block: str = "",
                     agent: str | None = None, disabled_agents: set[str] | None = None) -> AsyncIterator[Event]:
        disabled_agents = disabled_agents or set()
        enabled = {k for k in AGENTS if k not in disabled_agents}
        queue: asyncio.Queue[Event] = asyncio.Queue()

        async def emit(e: Event):
            await queue.put(e)

        if agent and agent != "main":
            if agent not in enabled:
                yield Event("error", {"message": f"Agenten {agent} er deaktiveret"})
                return
            plan = {"mode": "single", "agent": agent}
        else:
            agents_txt = "\n".join(f"- {a.key}: {a.description}" for a in AGENTS.values() if a.key in enabled)
            raw = await self.llm([{"role": "user", "content": ORCHESTRATOR_PROMPT.format(agents=agents_txt,
                                                                                          message=user_msg[:4000])}],
                                 "local_small", True)
            plan = parse_plan(raw, enabled)
        yield Event("plan", plan)

        results: list[AgentResult] = []
        if plan["mode"] in ("single", "multi"):
            jobs = [(plan["agent"], user_msg)] if plan["mode"] == "single" else [(t["agent"], t["task"]) for t in plan["tasks"]]
            for key, _ in jobs:
                yield Event("status", {"message": f"{AGENTS[key].name} arbejder…", "agent": key})

            async def run(key: str, task: str) -> AgentResult:
                sub = ToolContext(actor=ctx.actor, agent=key, conversation_id=ctx.conversation_id, tainted=ctx.tainted,
                                  policy=ctx.policy, db=ctx.db, sources=ctx.sources,
                                  request_approval=ctx.request_approval, audit=ctx.audit)
                hist = history if plan["mode"] == "single" else []
                return await run_agent(AGENTS[key], task, hist, sub, self.tools, self.llm, memory_block, emit,
                                       ctx.policy.disabled_tools)

            # Agenter deler databasesession – kør derfor sekventielt når der er en db, ellers parallelt
            if ctx.db is not None:
                for key, task in jobs:
                    t = asyncio.create_task(run(key, task))
                    while not t.done():
                        try:
                            yield await asyncio.wait_for(queue.get(), 0.2)
                        except asyncio.TimeoutError:
                            pass
                    results.append(t.result())
            else:
                t = asyncio.gather(*(run(k, task) for k, task in jobs))
                while not t.done():
                    try:
                        yield await asyncio.wait_for(queue.get(), 0.2)
                    except asyncio.TimeoutError:
                        pass
                results = list(t.result())
            while not queue.empty():
                yield queue.get_nowait()

        # Endeligt svar streames
        if plan["mode"] == "single":
            text = results[0].text
            for i in range(0, len(text), 40):
                yield Event("token", {"text": text[i:i + 40]})
            yield Event("done", {"agents": [results[0].agent], "approvals": results[0].pending_approvals})
            return

        from app.agents.definitions import BASE
        system = "\n\n".join(x for x in [BASE, SYSTEM_GUARD, memory_block] if x)
        if plan["mode"] == "multi":
            combined = "\n\n".join(f"### {AGENTS[r.agent].name}\n{r.text}" for r in results)
            messages = [{"role": "system", "content": system}, *history[-10:],
                        {"role": "user", "content": f"{user_msg}\n\nDine specialagenter har leveret:\n{combined}\n\n"
                                                    "Saml det til ét klart, sammenhængende svar med kilder."}]
            tier = "local_large"
        else:
            messages = [{"role": "system", "content": system}, *history[-20:], {"role": "user", "content": user_msg}]
            tier = None
        async for tok in self.stream(messages, tier):
            yield Event("token", {"text": tok})
        yield Event("done", {"agents": [r.agent for r in results],
                             "approvals": [a for r in results for a in r.pending_approvals]})
