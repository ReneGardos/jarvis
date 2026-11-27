"""Upload, indeksering, søgning og oprettelse af dokumenter."""
from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import Document
from app.documents.parsers import IMAGE_EXT, SUPPORTED, _ext, chunk_text, parse_bytes
from app.memory.vectorstore import point_id, vectors

log = logging.getLogger("jarvis.docs")
_s = get_settings()
MAX_UPLOAD = 50 * 1024 * 1024


def safe_name(name: str) -> str:
    name = Path(name).name
    return re.sub(r"[^\w.\- æøåÆØÅ]", "_", name)[:200] or "fil"


async def ingest(db: AsyncSession, filename: str, data: bytes, mime: str, folder: str = "",
                 project_id: int | None = None) -> Document:
    if len(data) > MAX_UPLOAD:
        raise ValueError("Filen er større end 50 MB")
    if _ext(filename) not in SUPPORTED:
        raise ValueError(f"Filtypen {_ext(filename) or '(ukendt)'} understøttes ikke")
    sha = hashlib.sha256(data).hexdigest()
    dest_dir = _s.upload_dir / "documents"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{uuid.uuid4().hex}_{safe_name(filename)}"
    dest.write_bytes(data)
    doc = Document(filename=safe_name(filename), path=str(dest), mime=mime, size=len(data), sha256=sha,
                   folder=folder, project_id=project_id, status="processing")
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    try:
        text = parse_bytes(data, mime, filename)
        if _ext(filename) in IMAGE_EXT:
            text = await describe_image(data) or text
        doc.text_preview = text[:3000]
        chunks = chunk_text(text)
        await vectors.upsert("documents", [
            (point_id("doc", f"{doc.id}:{i}"), c, {"document_id": doc.id, "chunk": i, "filename": doc.filename})
            for i, c in enumerate(chunks)])
        doc.chunk_count = len(chunks)
        doc.status = "ready"
    except Exception as e:
        log.exception("Indeksering fejlede")
        doc.status = f"fejl: {e}"[:20]
    await db.commit()
    return doc


async def describe_image(data: bytes) -> str:
    """Bruger en lokal vision-model (fx llava/qwen2.5vl) via Ollama hvis den er installeret."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            tags = (await c.get(f"{_s.ollama_url}/api/tags")).json().get("models", [])
            vision = next((m["name"] for m in tags if any(v in m["name"] for v in ("llava", "vl", "vision", "moondream"))), None)
            if not vision:
                return ""
            r = await c.post(f"{_s.ollama_url}/api/generate", json={
                "model": vision, "stream": False, "images": [base64.b64encode(data).decode()],
                "prompt": "Beskriv billedet detaljeret på dansk, inkl. al synlig tekst."})
            return r.json().get("response", "")
    except Exception:
        return ""


async def search(query: str, limit: int = 6, document_id: int | None = None) -> list[dict]:
    flt = {"document_id": document_id} if document_id else None
    return await vectors.search("documents", query, limit=limit, flt=flt)


async def remove(db: AsyncSession, doc: Document) -> None:
    try:
        await vectors.delete("documents", flt={"document_id": doc.id})
    except Exception:
        pass
    Path(doc.path).unlink(missing_ok=True)
    await db.delete(doc)
    await db.commit()


def create_file(kind: str, title: str, content) -> Path:
    """Opretter docx (tekst med markdown-overskrifter), xlsx (liste af rækker) eller md/txt."""
    out_dir = _s.upload_dir / "generated"
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / f"{safe_name(title)}_{uuid.uuid4().hex[:6]}"
    if kind == "docx":
        import docx
        d = docx.Document()
        d.add_heading(title, 0)
        for line in str(content).splitlines():
            m = re.match(r"^(#{1,3})\s+(.*)", line)
            if m:
                d.add_heading(m.group(2), len(m.group(1)))
            elif line.startswith(("- ", "* ")):
                d.add_paragraph(line[2:], style="List Bullet")
            elif line.strip():
                d.add_paragraph(line)
        path = base.with_suffix(".docx")
        d.save(path)
    elif kind == "xlsx":
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = title[:30]
        for row in content:
            ws.append(row if isinstance(row, list) else [row])
        path = base.with_suffix(".xlsx")
        wb.save(path)
    else:
        path = base.with_suffix(".md")
        path.write_text(str(content))
    return path
