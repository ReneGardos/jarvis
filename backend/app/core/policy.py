"""Policy-motor: afgør om en handling må udføres direkte, kræver godkendelse eller er forbudt.

Grundregler (kan ikke ændres af AI'en):
* Agenter kan aldrig ændre rettigheder, sikkerhedsindstillinger eller policy.
* Handlinger med økonomiske, juridiske, eksterne eller destruktive konsekvenser kræver godkendelse.
* Hvis konteksten indeholder ubetroet indhold (web, dokumenter, e-mails) skærpes kravene:
  alle skrivende handlinger kræver godkendelse ("taint tracking").
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Risk(IntEnum):
    READ = 0          # læse egne data, søge, analysere
    WRITE_LOCAL = 1   # oprette opgave, gemme hukommelse, kladde
    MODIFY = 2        # ændre/slette egne data, skrive filer, køre tests
    EXTERNAL = 3      # sende besked/e-mail, oprette kalenderaftale hos tredjepart, kalde ekstern API med skrivning
    CONSEQUENTIAL = 4 # økonomi, juridisk, køb, kontrakter, sletning af mange data
    SECURITY = 5      # rettigheder, nøgler, policy – aldrig tilladt for agenter


class Decision:
    ALLOW = "allow"
    APPROVE = "require_approval"
    DENY = "deny"


@dataclass
class PolicyConfig:
    # Højeste risiko der udføres uden godkendelse. Kan kun ændres af brugeren via API.
    auto_allow_max: Risk = Risk.WRITE_LOCAL
    disabled_agents: set[str] = field(default_factory=set)
    disabled_tools: set[str] = field(default_factory=set)


@dataclass
class PolicyResult:
    decision: str
    reason: str


def evaluate(*, actor: str, agent: str | None, tool: str, risk: Risk, tainted: bool,
             config: PolicyConfig) -> PolicyResult:
    """actor: 'user' (direkte fra UI) eller 'agent' (AI-initieret)."""
    if risk >= Risk.SECURITY:
        if actor == "user":
            return PolicyResult(Decision.ALLOW, "brugerens egen sikkerhedshandling")
        return PolicyResult(Decision.DENY, "AI'en må aldrig ændre sikkerhed eller rettigheder")
    if actor == "user":
        return PolicyResult(Decision.ALLOW, "direkte brugerhandling")
    if agent and agent in config.disabled_agents:
        return PolicyResult(Decision.DENY, f"agenten '{agent}' er deaktiveret")
    if tool in config.disabled_tools:
        return PolicyResult(Decision.DENY, f"værktøjet '{tool}' er deaktiveret")
    if risk >= Risk.EXTERNAL:
        return PolicyResult(Decision.APPROVE, "ekstern eller væsentlig handling kræver godkendelse")
    if tainted and risk >= Risk.WRITE_LOCAL:
        return PolicyResult(Decision.APPROVE, "konteksten indeholder ubetroet indhold – skrivning kræver godkendelse")
    if risk > config.auto_allow_max:
        return PolicyResult(Decision.APPROVE, "over grænsen for automatisk tilladelse")
    return PolicyResult(Decision.ALLOW, "inden for automatisk tilladelse")
