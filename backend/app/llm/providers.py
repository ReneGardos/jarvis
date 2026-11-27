"""Implementeringer for Ollama (lokal), OpenAI (og OpenAI-kompatible) samt Anthropic."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.llm.base import ChatResult, LLMProvider, StreamChunk

TIMEOUT = httpx.Timeout(300.0, connect=10.0)


def _split_system(messages: list[dict]) -> tuple[str, list[dict]]:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    rest = [{"role": m["role"] if m["role"] in ("user", "assistant") else "user", "content": m["content"]}
            for m in messages if m["role"] != "system"]
    # Anthropic kræver alternerende roller – flet efterfølgende beskeder med samme rolle
    merged: list[dict] = []
    for m in rest:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append(dict(m))
    if merged and merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": "(fortsæt)"})
    return system, merged


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def chat(self, spec, messages, *, temperature=0.4, max_tokens=2048, json_mode=False):
        body = {"model": spec.model, "messages": messages, "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": spec.context_window}}
        if json_mode:
            body["format"] = "json"
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"{spec.base_url or self.base_url}/api/chat", json=body)
            r.raise_for_status()
            d = r.json()
        return ChatResult(d["message"]["content"], d.get("prompt_eval_count", 0), d.get("eval_count", 0),
                          spec.model, self.name)

    async def stream(self, spec, messages, *, temperature=0.4, max_tokens=2048) -> AsyncIterator[StreamChunk]:
        body = {"model": spec.model, "messages": messages, "stream": True,
                "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": spec.context_window}}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            async with c.stream("POST", f"{spec.base_url or self.base_url}/api/chat", json=body) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    d = json.loads(line)
                    if d.get("done"):
                        yield StreamChunk(done=True, tokens_in=d.get("prompt_eval_count", 0),
                                          tokens_out=d.get("eval_count", 0))
                    else:
                        yield StreamChunk(delta=d.get("message", {}).get("content", ""))

    async def health(self, spec) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{self.base_url}/api/tags")
                names = {m["name"] for m in r.json().get("models", [])}
                return spec.model in names or f"{spec.model}:latest" in names
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
            return r.json().get("models", [])

    async def pull(self, model: str) -> AsyncIterator[dict]:
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream("POST", f"{self.base_url}/api/pull", json={"model": model}) as r:
                async for line in r.aiter_lines():
                    if line:
                        yield json.loads(line)

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"{self.base_url}/api/embed", json={"model": model, "input": texts})
            r.raise_for_status()
            return r.json()["embeddings"]


class OpenAIProvider(LLMProvider):
    """Virker også med OpenAI-kompatible servere (vLLM, LM Studio, Groq, OpenRouter) via base_url."""
    name = "openai"

    def _url(self, spec):
        return (spec.base_url or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"

    def _headers(self, spec):
        if not spec.api_key:
            raise RuntimeError(f"Ingen API-nøgle konfigureret for {spec.model}")
        return {"Authorization": f"Bearer {spec.api_key}"}

    async def chat(self, spec, messages, *, temperature=0.4, max_tokens=2048, json_mode=False):
        body = {"model": spec.model, "messages": messages, "temperature": temperature, "max_completion_tokens": max_tokens}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(self._url(spec), json=body, headers=self._headers(spec))
            r.raise_for_status()
            d = r.json()
        u = d.get("usage", {})
        return ChatResult(d["choices"][0]["message"]["content"] or "", u.get("prompt_tokens", 0),
                          u.get("completion_tokens", 0), spec.model, self.name)

    async def stream(self, spec, messages, *, temperature=0.4, max_tokens=2048):
        body = {"model": spec.model, "messages": messages, "temperature": temperature,
                "max_completion_tokens": max_tokens, "stream": True, "stream_options": {"include_usage": True}}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            async with c.stream("POST", self._url(spec), json=body, headers=self._headers(spec)) as r:
                r.raise_for_status()
                tin = tout = 0
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    d = json.loads(data)
                    if d.get("usage"):
                        tin, tout = d["usage"].get("prompt_tokens", 0), d["usage"].get("completion_tokens", 0)
                    for ch in d.get("choices", []):
                        if ch.get("delta", {}).get("content"):
                            yield StreamChunk(delta=ch["delta"]["content"])
                yield StreamChunk(done=True, tokens_in=tin, tokens_out=tout)


class AnthropicProvider(LLMProvider):
    name = "anthropic"
    URL = "https://api.anthropic.com/v1/messages"

    def _headers(self, spec):
        if not spec.api_key:
            raise RuntimeError(f"Ingen API-nøgle konfigureret for {spec.model}")
        return {"x-api-key": spec.api_key, "anthropic-version": "2023-06-01"}

    async def chat(self, spec, messages, *, temperature=0.4, max_tokens=2048, json_mode=False):
        system, msgs = _split_system(messages)
        if json_mode:
            system += "\n\nSvar udelukkende med gyldig JSON."
        body = {"model": spec.model, "system": system, "messages": msgs, "max_tokens": max_tokens,
                "temperature": temperature}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(self.URL, json=body, headers=self._headers(spec))
            r.raise_for_status()
            d = r.json()
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
        u = d.get("usage", {})
        return ChatResult(text, u.get("input_tokens", 0), u.get("output_tokens", 0), spec.model, self.name)

    async def stream(self, spec, messages, *, temperature=0.4, max_tokens=2048):
        system, msgs = _split_system(messages)
        body = {"model": spec.model, "system": system, "messages": msgs, "max_tokens": max_tokens,
                "temperature": temperature, "stream": True}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            async with c.stream("POST", self.URL, json=body, headers=self._headers(spec)) as r:
                r.raise_for_status()
                tin = tout = 0
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    d = json.loads(line[6:])
                    t = d.get("type")
                    if t == "message_start":
                        tin = d["message"].get("usage", {}).get("input_tokens", 0)
                    elif t == "content_block_delta" and d["delta"].get("type") == "text_delta":
                        yield StreamChunk(delta=d["delta"]["text"])
                    elif t == "message_delta":
                        tout = d.get("usage", {}).get("output_tokens", tout)
                yield StreamChunk(done=True, tokens_in=tin, tokens_out=tout)
