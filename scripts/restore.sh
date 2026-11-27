#!/usr/bin/env bash
# Gendanner en krypteret backup: ./scripts/restore.sh data/backups/jarvis-YYYYMMDD-HHMMSS.tar.gz.enc
# Kræver samme JARVIS_MASTER_KEY som da backuppen blev taget.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Angiv backupfil}"
[ -f "$FILE" ] || { echo "Filen findes ikke: $FILE"; exit 1; }
read -rp "Dette OVERSKRIVER den nuværende database og uploads. Skriv JA for at fortsætte: " ok
[ "$ok" = "JA" ] || exit 1
NAME=$(basename "$FILE")
docker compose exec -T backend python - "$NAME" <<'PY'
import sys, pathlib
from app.core.config import get_settings
from app.services.backup import decrypt_backup
s = get_settings()
dest = pathlib.Path("/tmp/restore"); dest.mkdir(exist_ok=True)
decrypt_backup(s.backup_dir / sys.argv[1], s.master_key, dest)
print("Dekrypteret til", dest)
PY
docker compose stop frontend
docker compose exec -T backend sh -c 'PGPASSWORD="$(echo $DATABASE_URL | sed -E "s#.*://[^:]+:([^@]+)@.*#\1#")" \
  pg_restore --clean --if-exists --no-owner -h postgres -U jarvis -d jarvis /tmp/restore/database.dump'
docker compose exec -T backend sh -c 'rm -rf /data/uploads/* && cp -a /tmp/restore/uploads/. /data/uploads/ 2>/dev/null || true; rm -rf /tmp/restore'
docker compose restart backend frontend
echo "Gendannet. Hvis søgning mangler resultater: Systemindstillinger → Genindeksér (eller POST /api/maintenance/reindex)."
