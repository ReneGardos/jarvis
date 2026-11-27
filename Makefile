.PHONY: install up down logs test backup update
install: ; ./scripts/install.sh
up: ; docker compose up -d
down: ; docker compose down
logs: ; docker compose logs -f backend
test: ; docker compose exec backend pytest -q
backup: ; ./scripts/backup.sh
update: ; git pull && docker compose up -d --build
