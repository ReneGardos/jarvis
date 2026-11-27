# Jarvis – personlig AI-assistent

Din egen AI-assistent, som du ejer og kontrollerer. Den kører lokalt med open source-modeller og bruger cloudmodeller
(Anthropic/OpenAI) som supplement inden for et fast månedsbudget.

**Funktioner**
* Chat med streaming, 8 specialagenter (Personal, Research, Developer, Business, Marketing, Finance, Planning, Document) og en hovedassistent der fordeler opgaver
* Hukommelse med kort- og langtidshukommelse, automatisk udtræk og fuld kontrol over at se, rette, fastgøre og slette
* Kalender med tovejs-synk til Apple iCloud (CalDAV), opgaver med prioritet, deadlines og påmindelser, projekter, dags- og ugeplaner
* Stemme med wake word "Jarvis", løbende samtale, afbrydelse, dansk/engelsk, lokal Whisper og Piper – virker på computer og mobil
* Internet research via lokal SearXNG (Google, Bing, DuckDuckGo m.fl.) med kildehenvisninger og gemte rapporter
* Dokumenter: PDF, Word, Excel, PowerPoint, TXT, CSV, kode og billeder – søgning, resuméer og oprettelse af nye dokumenter
* AI-programmør der arbejder i dine projektmapper med kontrolleret filadgang, godkendelse og automatisk backup
* Automatiseringer (cron): dagsrapporter, agent-prompts, overvågning af websider og påmindelser – med push til mobil
* Model Management: lokale og cloudmodeller, automatisk valg efter kompleksitet, budgetloft, forbrugsoversigt og krypterede nøgler
* Sikkerhed: login, krypterede hemmeligheder, policy-motor, godkendelser, beskyttelse mod prompt injection, aktivitetslog og krypteret natlig backup

**Kom i gang:** `./scripts/install.sh` → http://localhost:3000. Se [docs/INSTALL.md](docs/INSTALL.md).

| Dokument | Indhold |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | Hardware, installation, Apple Kalender, mobil/HTTPS, drift, fejlfinding |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Opbygning, dataflow, modelvalg, hukommelse, udvidelse |
| [docs/API.md](docs/API.md) | Alle endpoints, SSE-hændelser, risikoniveauer |
| [docs/SECURITY.md](docs/SECURITY.md) | Sikkerhedsmodel og anbefalinger |
| [docs/STATUS.md](docs/STATUS.md) | Hvad er testet, og næste skridt |

```
jarvis/
├── backend/        FastAPI · SQLAlchemy · Alembic · tests/
├── frontend/       Next.js 15 · React 19 · Tailwind
├── infra/          Caddyfile · SearXNG-konfiguration
├── scripts/        install · gen_secrets · pull_models · download_voices · backup · restore
├── docs/
└── docker-compose.yml
```
