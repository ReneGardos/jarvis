"""Kontrolleret filadgang og kommandokørsel for Developer-agenten."""
from __future__ import annotations

import asyncio
import os
import shlex
from pathlib import Path

DENY_NAMES = {".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", ".netrc", ".npmrc", ".pypirc",
              "credentials.json", "secrets.json"}
DENY_DIRS = {".git", ".ssh", "node_modules", ".venv", "venv", "__pycache__", ".next"}
MAX_READ = 400_000

# Kun disse programmer må køres, og kun som én kommando uden shell
ALLOWED_PREFIXES = [
    ["pytest"], ["python", "-m", "pytest"], ["python", "-m", "ruff"], ["ruff", "check"],
    ["npm", "test"], ["npm", "run", "test"], ["npm", "run", "lint"], ["npm", "run", "build"],
    ["npx", "tsc", "--noEmit"], ["git", "status"], ["git", "diff"], ["git", "log"],
]


class Sandbox:
    def __init__(self, roots: list[str]):
        self.roots = [Path(r).resolve() for r in roots]

    def resolve(self, path: str) -> Path:
        p = Path(path)
        if not p.is_absolute():
            p = self.roots[0] / p
        p = p.resolve()  # følger symlinks – så et symlink ud af roden afvises
        if not any(p == r or r in p.parents for r in self.roots):
            raise PermissionError(f"{path} ligger uden for de godkendte projektmapper")
        parts = set(p.parts)
        if p.name in DENY_NAMES or parts & {".ssh"} or p.name.startswith(".env"):
            raise PermissionError(f"{p.name} er en beskyttet fil")
        return p

    def list_dir(self, path: str = ".", depth: int = 2) -> list[str]:
        base = self.resolve(path)
        out: list[str] = []

        def walk(d: Path, lvl: int):
            try:
                entries = sorted(d.iterdir(), key=lambda x: (x.is_file(), x.name))
            except OSError:
                return
            for e in entries:
                if e.name in DENY_DIRS or e.name in DENY_NAMES:
                    continue
                rel = e.relative_to(base)
                out.append(f"{rel}/" if e.is_dir() else str(rel))
                if len(out) > 500:
                    return
                if e.is_dir() and lvl < depth:
                    walk(e, lvl + 1)
        walk(base, 1)
        return out

    def read(self, path: str) -> str:
        p = self.resolve(path)
        if p.stat().st_size > MAX_READ:
            raise ValueError("Filen er for stor til at læse direkte")
        return p.read_text(errors="replace")

    def write(self, path: str, content: str) -> dict:
        p = self.resolve(path)
        backup = None
        if p.exists():
            backup = p.with_suffix(p.suffix + ".jarvis-bak")
            backup.write_bytes(p.read_bytes())
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return {"path": str(p), "bytes": len(content.encode()), "backup": str(backup) if backup else None}

    def search(self, pattern: str, path: str = ".", max_hits: int = 100) -> list[str]:
        base = self.resolve(path)
        hits = []
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in DENY_DIRS]
            for f in files:
                if f in DENY_NAMES or f.startswith(".env"):
                    continue
                fp = Path(root) / f
                try:
                    if fp.stat().st_size > MAX_READ:
                        continue
                    for i, line in enumerate(fp.read_text(errors="ignore").splitlines(), 1):
                        if pattern.lower() in line.lower():
                            hits.append(f"{fp.relative_to(base)}:{i}: {line.strip()[:200]}")
                            if len(hits) >= max_hits:
                                return hits
                except (OSError, UnicodeDecodeError):
                    continue
        return hits

    @staticmethod
    def check_command(command: str) -> list[str]:
        argv = shlex.split(command)
        if not argv:
            raise PermissionError("Tom kommando")
        if any(ch in command for ch in [";", "&&", "||", "|", "`", "$(", ">", "<"]):
            raise PermissionError("Kædede kommandoer og omdirigering er ikke tilladt")
        if not any(argv[:len(pref)] == pref for pref in ALLOWED_PREFIXES):
            raise PermissionError(f"Kommandoen er ikke på listen over tilladte: {argv[0]}")
        return argv

    async def run(self, command: str, cwd: str = ".", timeout: int = 300) -> dict:
        argv = self.check_command(command)
        wd = self.resolve(cwd)
        env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "LANG", "TZ"}}
        proc = await asyncio.create_subprocess_exec(*argv, cwd=wd, env=env, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.STDOUT)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {"exit_code": -1, "output": f"Timeout efter {timeout}s"}
        text = out.decode(errors="replace")
        return {"exit_code": proc.returncode, "output": text[-15000:]}
