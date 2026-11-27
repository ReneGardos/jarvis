"""Tekstudtræk fra PDF, Word, Excel, PowerPoint, TXT, CSV, kode og billeder + opdeling i tekststykker."""
from __future__ import annotations

import csv
import io
import re

CODE_EXT = {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html", ".css", ".sql", ".yml", ".yaml", ".toml",
            ".sh", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".php", ".rb", ".swift", ".kt", ".xml", ".ini"}
SUPPORTED = {".pdf", ".docx", ".xlsx", ".xlsm", ".pptx", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif"} | CODE_EXT
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _ext(name: str) -> str:
    m = re.search(r"\.[A-Za-z0-9]+$", name)
    return m.group(0).lower() if m else ""


def parse_bytes(data: bytes, mime: str, filename: str) -> str:
    ext = _ext(filename)
    if ext == ".pdf" or "pdf" in mime:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(f"[Side {i}]\n{(p.extract_text() or '').strip()}" for i, p in enumerate(reader.pages, 1))
    if ext == ".docx":
        import docx
        d = docx.Document(io.BytesIO(data))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for t in d.tables:
            for row in t.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n".join(parts)
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        parts = []
        for ws in wb.worksheets:
            parts.append(f"## Ark: {ws.title}")
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i > 2000:
                    parts.append("… (afkortet)")
                    break
                if any(v is not None for v in row):
                    parts.append(" | ".join("" if v is None else str(v) for v in row))
        return "\n".join(parts)
    if ext == ".pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        parts = []
        for i, slide in enumerate(prs.slides, 1):
            texts = [sh.text_frame.text for sh in slide.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
            notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
            parts.append(f"[Slide {i}]\n" + "\n".join(texts) + (f"\nNoter: {notes}" if notes.strip() else ""))
        return "\n\n".join(parts)
    if ext == ".csv":
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(text), dialect))[:5000]
        return "\n".join(" | ".join(r) for r in rows)
    if ext in IMAGE_EXT:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        return f"[Billede {img.width}x{img.height} {img.format}] (beskrivelse genereres af vision-model hvis tilgængelig)"
    return data.decode("utf-8", errors="replace")


def chunk_text(text: str, size: int = 1200, overlap: int = 200) -> list[str]:
    """Opdeler i overlappende stykker, helst ved afsnits- eller sætningsgrænser."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    chunks, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if cut > size * 0.5:
                end = start + cut + 1
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]
