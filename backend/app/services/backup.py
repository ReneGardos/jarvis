"""Krypteret backup af database, vektordatabase og uploads. Gendannelse: scripts/restore.sh."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tarfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet

from app.core.config import get_settings

log = logging.getLogger("jarvis.backup")
_s = get_settings()
KEEP = 14


def _pg_env() -> tuple[list[str], dict]:
    u = urlparse(_s.database_url.replace("+asyncpg", ""))
    env = {**os.environ, "PGPASSWORD": u.password or ""}
    return ["-h", u.hostname or "localhost", "-p", str(u.port or 5432), "-U", u.username or "jarvis",
            "-d", (u.path or "/jarvis").lstrip("/")], env


async def run_backup() -> dict:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    _s.backup_dir.mkdir(parents=True, exist_ok=True)
    args, env = _pg_env()
    proc = await asyncio.create_subprocess_exec("pg_dump", "--format=custom", *args, env=env,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    dump, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"pg_dump fejlede: {err.decode()[:500]}")

    snapshots: list[str] = []
    try:
        from app.memory.vectorstore import vectors
        snapshots = await vectors.snapshot_all()
    except Exception as e:
        log.warning("Qdrant-snapshot fejlede (genopbygges fra Postgres ved gendannelse): %s", e)

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        info = tarfile.TarInfo("database.dump")
        info.size = len(dump)
        tar.addfile(info, io.BytesIO(dump))
        meta = json.dumps({"created": stamp, "qdrant_snapshots": snapshots, "version": 1}).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(meta)
        tar.addfile(info, io.BytesIO(meta))
        if _s.upload_dir.exists():
            tar.add(_s.upload_dir, arcname="uploads")
    encrypted = Fernet(_s.master_key.encode()).encrypt(buf.getvalue())
    out = _s.backup_dir / f"jarvis-{stamp}.tar.gz.enc"
    out.write_bytes(encrypted)
    os.chmod(out, 0o600)

    backups = sorted(_s.backup_dir.glob("jarvis-*.tar.gz.enc"))
    for old in backups[:-KEEP]:
        old.unlink()
    log.info("Backup gemt: %s (%d bytes)", out, len(encrypted))
    return {"file": out.name, "bytes": len(encrypted), "qdrant_snapshots": snapshots}


def list_backups() -> list[dict]:
    if not _s.backup_dir.exists():
        return []
    return [{"file": p.name, "bytes": p.stat().st_size, "created": datetime.fromtimestamp(p.stat().st_mtime).isoformat()}
            for p in sorted(_s.backup_dir.glob("jarvis-*.tar.gz.enc"), reverse=True)]


def decrypt_backup(path: Path, master_key: str, dest: Path) -> None:
    """Bruges af scripts/restore.py."""
    data = Fernet(master_key.encode()).decrypt(path.read_bytes())
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(dest, filter="data")
