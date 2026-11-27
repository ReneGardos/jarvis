#!/usr/bin/env bash
# Førstegangsinstallation. Kræver Docker + Docker Compose.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Installer Docker først: https://docs.docker.com/get-docker/"; exit 1; }
python3 scripts/gen_secrets.py
if ! grep -qE '^ADMIN_EMAIL=.+' .env; then
  read -rp "Din e-mail (login): " email
  read -rsp "Adgangskode (mindst 12 tegn): " pw; echo
  sed -i.bak -e "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$email|" -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$pw|" .env && rm -f .env.bak
fi
mkdir -p data/{uploads,backups,voice-models,workspace}
docker compose up -d --build
echo "Venter på backend…"
for i in $(seq 1 60); do curl -fs http://localhost:8000/api/health >/dev/null && break; sleep 3; done
./scripts/pull_models.sh
./scripts/download_voices.sh || true
docker compose restart backend
sed -i.bak "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=|" .env && rm -f .env.bak
echo
echo "✅ Jarvis kører: http://localhost:3000  (API-dokumentation: http://localhost:8000/api/docs)"
