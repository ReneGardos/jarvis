"""Jarvis backend – FastAPI. API-dokumentation: /api/docs (kræver login i UI for kald)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text

from app.api.routes import auth, chat, documents, memory, planning, system
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import User
from app.db.session import SessionLocal
from app.llm.registry import registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jarvis")
VERSION = "1.0.0"


async def bootstrap() -> None:
    s = get_settings()
    missing = s.validate_required()
    if missing:
        raise RuntimeError(f"Manglende konfiguration: {', '.join(missing)}. Kør scripts/gen_secrets.py")
    async with SessionLocal() as db:
        if (await db.scalar(select(func.count()).select_from(User))) == 0:
            if not (s.admin_email and s.admin_password):
                raise RuntimeError("Ingen bruger findes. Sæt ADMIN_EMAIL og ADMIN_PASSWORD i .env")
            db.add(User(email=s.admin_email.lower(), password_hash=hash_password(s.admin_password), display_name="Ejer"))
            await db.commit()
            log.info("Bruger %s oprettet. Fjern ADMIN_PASSWORD fra .env nu.", s.admin_email)
        await registry.seed(db)
    try:
        from app.memory.vectorstore import vectors
        await vectors.ensure_collections()
    except Exception as e:
        log.warning("Qdrant/embeddings ikke klar endnu (%s). Hukommelse falder tilbage til tekstsøgning.", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap()
    from app.services import automation
    await automation.start()
    log.info("Jarvis %s kører", VERSION)
    yield
    automation.scheduler.shutdown(wait=False)


app = FastAPI(title="Jarvis API", version=VERSION, lifespan=lifespan, docs_url="/api/docs",
              openapi_url="/api/openapi.json", redoc_url="/api/redoc")

app.add_middleware(CORSMiddleware, allow_origins=[get_settings().frontend_origin], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = resp.headers.get("Cache-Control", "no-store")
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Uventet fejl på %s", request.url.path)
    return JSONResponse({"detail": "Intern fejl – se backend-loggen"}, status_code=500)


@app.get("/api/health", tags=["system"])
async def health():
    from app.llm.registry import ollama
    import httpx
    status = {"version": VERSION, "database": False, "ollama": False, "qdrant": False}
    try:
        async with SessionLocal() as db:
            await db.execute(text("select 1"))
        status["database"] = True
    except Exception:
        pass
    try:
        await ollama.list_models()
        status["ollama"] = True
    except Exception:
        pass
    try:
        s = get_settings()
        async with httpx.AsyncClient(timeout=3, headers={"api-key": s.qdrant_api_key}) as c:
            status["qdrant"] = (await c.get(f"{s.qdrant_url}/collections")).status_code == 200
    except Exception:
        pass
    return status


for r in (auth, chat, memory, planning, documents, system):
    app.include_router(r.router)
