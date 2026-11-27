"""Automatisk modelvalg efter opgavens kompleksitet.

Strategi: prøv altid den billigste lokale model der kan løse opgaven. Cloud bruges kun når
opgaven er kompleks, en lokal model ikke er tilgængelig, eller brugeren vælger det, og
kun så længe månedsbudgettet ikke er brugt op.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.llm.base import ModelSpec

_CODE = re.compile(r"```|\b(kode|code|python|typescript|javascript|react|next\.?js|sql|api|bug|fejl|stack ?trace|"
                   r"traceback|exception|funktion|function|refactor|debug|compile|build)\b", re.I)
_DEEP = re.compile(r"\b(analys|strategi|strategy|sammenlign|compare|vurder|evaluate|forretningsplan|business plan|"
                   r"juridisk|legal|kontrakt|contract|budget|investering|arkitektur|architecture|research|undersøg|"
                   r"rapport|report|bevis|prove|step by step|trin for trin)\w*", re.I)


@dataclass
class RouteDecision:
    spec: ModelSpec
    complexity: int  # 1–5
    reason: str


def estimate_complexity(text: str, *, history_len: int = 0, needs_tools: bool = False,
                        doc_tokens: int = 0) -> int:
    score = 1
    n = len(text)
    if n > 400:
        score += 1
    if n > 2000:
        score += 1
    if _DEEP.search(text):
        score += 1
    if _CODE.search(text) and n > 300:
        score += 1
    if needs_tools:
        score += 1
    if history_len > 30 or doc_tokens > 6000:
        score += 1
    return max(1, min(5, score))


def is_code_task(text: str) -> bool:
    return bool(_CODE.search(text))


def choose(models: list[ModelSpec], text: str, *, available: set[str], cloud_spent: float,
           cloud_budget: float, forced: str | None = None, prefer_cloud: bool = False,
           history_len: int = 0, needs_tools: bool = False, doc_tokens: int = 0,
           preferred_tier: str | None = None) -> RouteDecision:
    """available: nøgler 'provider:model' for modeller der svarer lige nu."""
    key = lambda m: f"{m.provider}:{m.model}"  # noqa: E731
    usable = [m for m in models if key(m) in available]
    if forced:
        for m in models:
            if key(m) == forced or m.model == forced:
                if key(m) not in available:
                    raise RuntimeError(f"Modellen {forced} er ikke tilgængelig lige nu")
                if not m.is_local and cloud_spent >= cloud_budget:
                    raise RuntimeError("Månedens cloudbudget er brugt op")
                return RouteDecision(m, 0, "valgt manuelt")
        raise RuntimeError(f"Ukendt model: {forced}")
    if not usable:
        raise RuntimeError("Ingen AI-modeller er tilgængelige. Start Ollama eller tilføj en cloudnøgle.")

    c = estimate_complexity(text, history_len=history_len, needs_tools=needs_tools, doc_tokens=doc_tokens)
    code = is_code_task(text)
    budget_ok = cloud_spent < cloud_budget
    by_tier = lambda t: [m for m in usable if m.tier == t]  # noqa: E731
    cloud = by_tier("cloud") if budget_ok else []
    # Billigste cloud først
    cloud.sort(key=lambda m: m.cost_in + m.cost_out)

    # Agentens foretrukne modelklasse respekteres – undtagen ved meget komplekse opgaver, hvor cloud vinder.
    # local_small bruges til intern klassifikation/udtræk og overstyres aldrig.
    if preferred_tier:
        group = cloud if preferred_tier == "cloud" else by_tier(preferred_tier)
        if group and (preferred_tier == "local_small" or not (c >= 4 and cloud)):
            return RouteDecision(group[0], c, f"agentens foretrukne klasse: {preferred_tier}")

    order: list[tuple[list[ModelSpec], str]] = []
    if prefer_cloud and cloud:
        order.append((cloud, "cloud foretrukket i indstillinger"))
    if code:
        order.append((by_tier("local_code"), "kodeopgave → lokal kodemodel"))
    if c <= 2:
        order += [(by_tier("local_small"), f"kompleksitet {c} → lille lokal model"),
                  (by_tier("local_large"), "lille model utilgængelig → stor lokal")]
    elif c == 3:
        order += [(by_tier("local_large"), f"kompleksitet {c} → stor lokal model"),
                  (by_tier("local_small"), "stor model utilgængelig → lille lokal")]
    else:
        order += [(cloud, f"kompleksitet {c} → cloudmodel"),
                  (by_tier("local_large"), "cloud utilgængelig/budget nået → stor lokal")]
    allowed = [m for m in usable if m.is_local or budget_ok]
    order += [(cloud, "fallback cloud"), (allowed, "fallback første tilgængelige")]
    for group, reason in order:
        if group:
            return RouteDecision(group[0], c, reason)
    raise RuntimeError("Ingen model kunne vælges (cloudbudget nået og ingen lokal model kører)")
