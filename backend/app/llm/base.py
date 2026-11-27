"""Fælles grænseflade for alle AI-modeller. Nye udbydere tilføjes ved at implementere LLMProvider."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass
class ChatResult:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""
    provider: str = ""


@dataclass
class StreamChunk:
    delta: str = ""
    done: bool = False
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class ModelSpec:
    provider: str
    model: str
    tier: str = "local_small"
    context_window: int = 8192
    cost_in: float = 0.0   # DKK pr. 1M tokens
    cost_out: float = 0.0
    capabilities: list[str] = field(default_factory=list)
    base_url: str = ""
    api_key: str = ""
    id: int | None = None

    @property
    def is_local(self) -> bool:
        return self.provider == "ollama"

    def cost(self, tin: int, tout: int) -> float:
        return (tin * self.cost_in + tout * self.cost_out) / 1_000_000


class LLMProvider(ABC):
    name: str

    @abstractmethod
    async def chat(self, spec: ModelSpec, messages: list[dict], *, temperature: float = 0.4,
                   max_tokens: int = 2048, json_mode: bool = False) -> ChatResult: ...

    @abstractmethod
    def stream(self, spec: ModelSpec, messages: list[dict], *, temperature: float = 0.4,
               max_tokens: int = 2048) -> AsyncIterator[StreamChunk]: ...

    async def health(self, spec: ModelSpec) -> bool:
        return True
