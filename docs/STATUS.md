# Status – version 1.0 (27. november 2026)

## Implementeret (fase 1–10)

| Fase | Indhold | Status |
|---|---|---|
| 1 | Projektstruktur, docker-compose (Postgres, Qdrant, Ollama, SearXNG, Caddy), hemmeligheder | ✅ |
| 2 | Dashboard med 15 sektioner, mørkt tema, mobilvenligt, PWA-manifest | ✅ |
| 3 | FastAPI, 15 tabeller, Alembic-migrationer, login, audit | ✅ |
| 4 | Ollama, OpenAI (+ kompatible), Anthropic, automatisk modelvalg, budgetloft, forbrug | ✅ |
| 5 | Hukommelse: kort/lang, udtræk, erstatning, rangering, fastgørelse, CRUD, fallback | ✅ |
| 6 | Stemme: VAD, wake word, løbende samtale, barge-in, Whisper, Piper, dansk/engelsk | ✅ |
| 7 | 8 agenter, orkestrator (direkte/én/flere), værktøjsloop, værktøjer begrænset pr. agent | ✅ |
| 8 | Dokumenter (8 formater + vision), søgning, resumé, oprettelse; research med kilder | ✅ |
| 9 | Kalender (CalDAV/iCloud), opgaver, påmindelser, automatiseringer, ntfy/e-mail | ✅ |
| 10 | Policy-motor, godkendelser, taint tracking, sandbox, SSRF-værn, backup/gendannelse | ✅ |

## Testet i udviklingsmiljøet

* **31 automatiserede tests består** (`backend/tests/test_core.py`): adgangskoder, JWT, kryptering, policy
  (inkl. at AI'en aldrig kan ændre sikkerhed), detektion af prompt injection, modelrouter og budget, hukommelsesrangering
  og -udtræk, værktøjsprotokol, agent-loop og orkestrator med falsk model, sandbox (udbrud via `..`, symlinks og
  `.env`), kommandotilladelser, kørsel af pytest i sandboxen, parsing af Word/Excel/PowerPoint/CSV, opdeling i tekststykker
  og ledige tidsrum.
* Hele backend kompilerer og er lint-ren (ruff F/E9/B).
* Hele frontend er syntaks- og typetjekket med TypeScript.

## Ikke kørt endnu – kræver din maskine

Udviklingsmiljøet havde ingen netværksadgang til pakkeinstallation og ingen Docker-daemon. Derfor er følgende **skrevet
færdigt, men ikke kørt ende-til-ende**: opstart af FastAPI mod en rigtig Postgres, `next build`, kald til
Ollama/Qdrant/SearXNG, iCloud-synk, Whisper/Piper og stemme i browseren.

**Første skridt hos dig:**
1. `./scripts/install.sh`
2. `docker compose exec backend pytest -q` (samme tests i containeren)
3. Log ind → *Overblik → Systemstatus* skal vise database/ollama/qdrant som "kører"
4. Prøv: chat "Hvad er klokken?" (værktøj), upload en PDF og søg i den, opret en opgave med påmindelse, start Voice
5. Meld fejl tilbage (gerne med `docker compose logs backend`), så retter vi dem i næste iteration

## Forslag til næste iteration

* Integrationstests mod Postgres/Qdrant i Docker (pytest + testcontainers)
* Godkendelse direkte fra ntfy-notifikationen (handlingsknapper)
* E-mail-indbakke som datakilde (IMAP, skrivebeskyttet)
* Ugentlig automatisk "hukommelsesrevision", hvor Jarvis foreslår sammenlægninger
* Native tool calling for cloudmodeller (hurtigere og mere stabilt end JSON-protokollen)
* Git-integration for Developer-agenten (branch + diff i godkendelsen i stedet for hele filen)
