"""Tynd klient til Qdrant REST API + embeddings via Ollama."""
from __future__ import annotations

import uuid

import httpx

from app.core.config import get_settings

_s = get_settings()
COLLECTIONS = {"memories", "documents", "conversations", "research"}


def point_id(kind: str, ref: str | int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"jarvis/{kind}/{ref}"))


class VectorStore:
    def __init__(self):
        self.url = _s.qdrant_url.rstrip("/")
        self.headers = {"api-key": _s.qdrant_api_key} if _s.qdrant_api_key else {}
        self._dim: int | None = None

    async def embed(self, texts: list[str]) -> list[list[float]]:
        from app.llm.registry import ollama
        # nomic-embed-text forventer task-præfikser
        return await ollama.embed(_s.ollama_embed_model, texts)

    async def ensure_collections(self) -> None:
        vec = (await self.embed(["dimension test"]))[0]
        self._dim = len(vec)
        async with httpx.AsyncClient(timeout=30, headers=self.headers) as c:
            for name in COLLECTIONS:
                r = await c.get(f"{self.url}/collections/{name}")
                if r.status_code == 404:
                    await c.put(f"{self.url}/collections/{name}",
                                json={"vectors": {"size": self._dim, "distance": "Cosine"}})

    async def upsert(self, collection: str, items: list[tuple[str, str, dict]]) -> None:
        """items: (id, tekst, payload)"""
        if not items:
            return
        vecs = await self.embed([f"search_document: {t}" for _, t, _ in items])
        points = [{"id": pid, "vector": v, "payload": {**p, "text": t[:4000]}}
                  for (pid, t, p), v in zip(items, vecs)]
        async with httpx.AsyncClient(timeout=60, headers=self.headers) as c:
            r = await c.put(f"{self.url}/collections/{collection}/points?wait=true", json={"points": points})
            r.raise_for_status()

    async def search(self, collection: str, query: str, limit: int = 8, flt: dict | None = None) -> list[dict]:
        vec = (await self.embed([f"search_query: {query}"]))[0]
        body = {"vector": vec, "limit": limit, "with_payload": True}
        if flt:
            body["filter"] = {"must": [{"key": k, "match": {"value": v}} for k, v in flt.items()]}
        async with httpx.AsyncClient(timeout=30, headers=self.headers) as c:
            r = await c.post(f"{self.url}/collections/{collection}/points/search", json=body)
            r.raise_for_status()
            return [{"id": h["id"], "score": h["score"], **h.get("payload", {})} for h in r.json()["result"]]

    async def delete(self, collection: str, ids: list[str] | None = None, flt: dict | None = None) -> None:
        body: dict = {"points": ids} if ids else {"filter": {"must": [{"key": k, "match": {"value": v}} for k, v in (flt or {}).items()]}}
        async with httpx.AsyncClient(timeout=30, headers=self.headers) as c:
            await c.post(f"{self.url}/collections/{collection}/points/delete?wait=true", json=body)

    async def snapshot_all(self) -> list[str]:
        names = []
        async with httpx.AsyncClient(timeout=300, headers=self.headers) as c:
            for col in COLLECTIONS:
                r = await c.post(f"{self.url}/collections/{col}/snapshots")
                if r.status_code == 200:
                    names.append(f"{col}/{r.json()['result']['name']}")
        return names


vectors = VectorStore()
