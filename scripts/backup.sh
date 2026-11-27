#!/usr/bin/env bash
# Manuel backup (samme som knappen i Systemindstillinger). Kopiér filerne i data/backups til en ekstern disk/cloud.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec backend python -c "import asyncio; from app.services.backup import run_backup; print(asyncio.run(run_backup()))"
