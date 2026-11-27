"""Modelregister: indlæser modeller fra databasen, holder styr på forbrug og vælger model."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import SecretVault
from app.db.models import ModelConfig, Secret, UsageRecord
from app.llm import router
from app.llm.base import ChatResult, LLMProvider, ModelSpec
from app.llm.providers import AnthropicProvider, OllamaProvider, OpenAIProvider

_settings = get_settings()
ollama = OllamaProvider(_settings.ollama_url)
PROVIDERS: dict[str, LLMProvider] = {
    "ollama": ollama,
    "openai": OpenAIProvider(),
    "openai_compatible": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
}

# Standardmodeller der oprettes ved første opstart. Priser i DKK pr. 1M tokens (ca., opdatér i UI).
DEFAULT_MODELS = [
    dict(provider="ollama", model=_settings.ollama_default_model, label="Lokal – hurtig", tier="local_small",
         context_window=16384, capabilities=["chat", "tools"]),
    dict(provider="ollama", model=_settings.ollama_large_model, label="Lokal – stor", tier="local_large",
         context_window=16384, capabilities=["chat", "tools", "reasoning"]),
    dict(provider="ollama", model=_settings.ollama_code_model, label="Lokal – kode", tier="local_code",
         context_window=16384, capabilities=["chat", "code"]),
    dict(provider="anthropic", model="claude-sonnet-5-5", label="Claude Sonnet", tier="cloud", context_window=200000,
         cost_in_dkk_per_mtok=21.0, cost_out_dkk_per_mtok=105.0, secret_name="anthropic_api_key",
         capabilities=["chat", "tools", "reasoning", "code", "vision"], enabled=False),
    dict(provider="openai", model="gpt-4.1-mini", label="GPT-4.1 mini", tier="cloud", context_window=128000,
         cost_in_dkk_per_mtok=2.8, cost_out_dkk_per_mtok=11.2, secret_name="openai_api_key",
         capabilities=["chat", "tools", "code"], enabled=False),
]


class Registry:
    def __init__(self):
        self._health: dict[str, tuple[float, bool]] = {}

    async def seed(self, db: AsyncSession) -> None:
        if (await db.scalar(select(func.count()).select_from(ModelConfig))) == 0:
            for m in DEFAULT_MODELS:
                db.add(ModelConfig(**m))
            await db.commit()
        # Nøgler fra .env flyttes krypteret ind i databasen
        vault = SecretVault(_settings.master_key)
        for name, val in (("openai_api_key", _settings.openai_api_key), ("anthropic_api_key", _settings.anthropic_api_key)):
            if val and not await db.scalar(select(Secret).where(Secret.name == name)):
                db.add(Secret(name=name, ciphertext=vault.encrypt(val)))
                await db.execute(ModelConfig.__table__.update().where(ModelConfig.secret_name == name).values(enabled=True))
        await db.commit()

    async def specs(self, db: AsyncSession) -> list[ModelSpec]:
        vault = SecretVault(_settings.master_key)
        rows = (await db.scalars(select(ModelConfig).where(ModelConfig.enabled.is_(True)))).all()
        secrets = {s.name: s.ciphertext for s in (await db.scalars(select(Secret))).all()}
        out = []
        for r in rows:
            key = vault.decrypt(secrets[r.secret_name]) if r.secret_name in secrets else ""
            out.append(ModelSpec(provider=r.provider, model=r.model, tier=r.tier, context_window=r.context_window,
                                 cost_in=r.cost_in_dkk_per_mtok, cost_out=r.cost_out_dkk_per_mtok,
                                 capabilities=r.capabilities or [], base_url=r.base_url, api_key=key, id=r.id))
        return out

    async def available(self, specs: list[ModelSpec]) -> set[str]:
        async def check(s: ModelSpec) -> tuple[str, bool]:
            k = f"{s.provider}:{s.model}"
            cached = self._health.get(k)
            if cached and time.time() - cached[0] < 60:
                return k, cached[1]
            ok = bool(s.api_key) if not s.is_local else await PROVIDERS[s.provider].health(s)
            self._health[k] = (time.time(), ok)
            return k, ok
        results = await asyncio.gather(*(check(s) for s in specs))
        return {k for k, ok in results if ok}

    async def cloud_spent_this_month(self, db: AsyncSession) -> float:
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return float(await db.scalar(select(func.coalesce(func.sum(UsageRecord.cost_dkk), 0.0))
                                     .where(UsageRecord.ts >= start)) or 0.0)

    async def route(self, db: AsyncSession, text: str, *, forced: str | None = None, history_len: int = 0,
                    needs_tools: bool = False, tier: str | None = None) -> router.RouteDecision:
        specs = await self.specs(db)
        avail = await self.available(specs)
        prefs = await _get_pref(db)
        return router.choose(specs, text, available=avail, cloud_spent=await self.cloud_spent_this_month(db),
                             cloud_budget=prefs.get("cloud_budget_dkk", _settings.cloud_budget_dkk_month),
                             forced=forced, prefer_cloud=prefs.get("prefer_cloud", False),
                             history_len=history_len, needs_tools=needs_tools, preferred_tier=tier)

    async def record_usage(self, db: AsyncSession, spec: ModelSpec, tin: int, tout: int, agent: str = "") -> None:
        db.add(UsageRecord(provider=spec.provider, model=spec.model, tokens_in=tin, tokens_out=tout,
                           cost_dkk=spec.cost(tin, tout), agent=agent))
        await db.commit()

    async def chat(self, db: AsyncSession, spec: ModelSpec, messages: list[dict], agent: str = "",
                   **kw) -> ChatResult:
        res = await PROVIDERS[spec.provider].chat(spec, messages, **kw)
        await self.record_usage(db, spec, res.tokens_in, res.tokens_out, agent)
        return res


async def _get_pref(db: AsyncSession) -> dict:
    from app.db.models import Setting
    s = await db.get(Setting, "models")
    return s.value if s else {}


registry = Registry()
