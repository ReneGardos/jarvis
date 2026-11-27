"""Værktøjsramme: definition, policy-kontrol, godkendelse og audit af alle AI-handlinger."""
from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.core.policy import Decision, PolicyConfig, Risk, evaluate


@dataclass
class ToolContext:
    actor: str = "agent"               # 'agent' eller 'user'
    agent: str = "main"
    conversation_id: int | None = None
    tainted: bool = False              # sættes når ubetroet indhold er kommet ind i konteksten
    policy: PolicyConfig = field(default_factory=PolicyConfig)
    db: Any = None
    sources: list[dict] = field(default_factory=list)
    # Callbacks injiceres af laget ovenover (gør rammen testbar uden database)
    request_approval: Callable[["ToolContext", "Tool", dict, str], Awaitable[int]] | None = None
    audit: Callable[..., Awaitable[None]] | None = None


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, str]             # navn -> beskrivelse (enkel, robust for lokale modeller)
    risk: Risk
    handler: Callable[[ToolContext, dict], Awaitable[Any]]
    taints: bool = False               # resultatet er ubetroet (web, dokumenter)
    summary: Callable[[dict], str] | None = None

    def describe(self) -> str:
        ps = ", ".join(f'"{k}": {v}' for k, v in self.params.items())
        return f"- {self.name}: {self.description} Argumenter: {{{ps}}}"


class ToolRegistry:
    def __init__(self):
        self.tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> Tool:
        self.tools[tool.name] = tool
        return tool

    def subset(self, names: list[str]) -> list[Tool]:
        return [self.tools[n] for n in names if n in self.tools]

    async def execute(self, ctx: ToolContext, name: str, args: dict) -> dict:
        tool = self.tools.get(name)
        if not tool:
            return {"ok": False, "error": f"Ukendt værktøj: {name}"}
        if not isinstance(args, dict):
            return {"ok": False, "error": "args skal være et objekt"}
        res = evaluate(actor=ctx.actor, agent=ctx.agent, tool=name, risk=tool.risk, tainted=ctx.tainted,
                       config=ctx.policy)
        if ctx.audit:
            await ctx.audit(actor=f"{ctx.actor}:{ctx.agent}", action=f"tool.{name}", target=json.dumps(args)[:300],
                            decision=res.decision, details={"args": args, "reason": res.reason})
        if res.decision == Decision.DENY:
            return {"ok": False, "error": f"Afvist: {res.reason}"}
        if res.decision == Decision.APPROVE:
            if not ctx.request_approval:
                return {"ok": False, "error": "Kræver godkendelse, men godkendelse er ikke tilgængelig her"}
            approval_id = await ctx.request_approval(ctx, tool, args, res.reason)
            return {"ok": True, "pending_approval": approval_id,
                    "message": f"Handlingen afventer brugerens godkendelse (#{approval_id}). "
                               f"Fortæl brugeren det og fortsæt ikke som om den er udført."}
        try:
            out = await tool.handler(ctx, args)
        except PermissionError as e:
            return {"ok": False, "error": f"Ingen adgang: {e}"}
        except Exception as e:  # værktøjsfejl gives tilbage til modellen, så den kan reagere
            return {"ok": False, "error": f"{type(e).__name__}: {e}"[:1000]}
        if tool.taints:
            ctx.tainted = True
        return {"ok": True, "result": out}


registry = ToolRegistry()

# ---------- Protokol for værktøjskald (virker med både lokale og cloudmodeller) ----------
_TOOL_RX = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```|^\s*(\{.*\})\s*$", re.S)


def parse_tool_call(text: str) -> tuple[str, dict] | None:
    """Finder {"tool": "...", "args": {...}} i modellens svar. Returnerer None ved endeligt svar."""
    for m in _TOOL_RX.finditer(text.strip()):
        raw = m.group(1) or m.group(2)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and isinstance(data.get("tool"), str):
            args = data.get("args") or data.get("arguments") or {}
            return data["tool"], args if isinstance(args, dict) else {}
    return None


def tool_instructions(tools: list[Tool]) -> str:
    if not tools:
        return ""
    return (
        "Du har adgang til disse værktøjer:\n" + "\n".join(t.describe() for t in tools) +
        "\n\nFor at bruge et værktøj svarer du KUN med en JSON-blok:\n"
        '```json\n{"tool": "navn", "args": {...}}\n```\n'
        "Du får resultatet tilbage og kan så kalde et nyt værktøj eller give dit endelige svar som almindelig tekst. "
        "Brug kun værktøjer når det er nødvendigt. Angiv kilder (URL eller dokumentnavn) når du bruger research."
    )
