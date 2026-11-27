# Jarvis API

Interaktiv, altid opdateret dokumentation genereres automatisk af FastAPI:

* Swagger UI: `http://localhost:8000/api/docs`
* ReDoc: `http://localhost:8000/api/redoc`
* OpenAPI-skema: `http://localhost:8000/api/openapi.json`

## Godkendelse

`POST /api/auth/login` med `{"email", "password"}` returnerer et JWT og sætter samtidig en
`httpOnly`-cookie (`jarvis_token`). Webappen bruger kun cookien. Andre klienter (fx en iOS-genvej eller
et script) sender `Authorization: Bearer <token>`. Alle endpoints undtagen `/api/auth/login` og
`/api/health` kræver login. Sessioner kan tilbagekaldes (`/api/auth/sessions/revoke-all`), og et token
virker ikke længere når dets session er tilbagekaldt.

Fem forkerte login-forsøg låser kontoen i 15 minutter.

## Chat (streaming)

`POST /api/conversations/{id}/messages` med `{"message": "...", "agent": null, "model": null}`
svarer som Server-Sent Events:

| event | data |
|---|---|
| `plan` | `{"mode": "direct" \| "single" \| "multi", ...}` – hvordan hovedassistenten fordelte opgaven |
| `status` | `{"message", "agent"}` – en agent er gået i gang |
| `tool_call` | `{"agent", "tool", "args"}` |
| `tool_result` | `{"agent", "tool", "ok", "error"}` |
| `approval` | `{"id", "tool", "args"}` – handlingen venter på godkendelse |
| `token` | `{"text"}` – del af svaret |
| `done` | `{"agents", "approvals"}` |
| `sources` | `{"sources": [{"title", "url"}]}` |
| `error` | `{"message"}` |
| `end` | `{}` – streamen lukkes |

`agent` kan være `main` (automatisk fordeling) eller en af `personal, research, developer, business,
marketing, finance, planning, document`. `model` er `"provider:model"` for manuelt modelvalg.

## Godkendelser

Når AI'en vil udføre en handling over din tilladelsesgrænse, oprettes en godkendelse.
`POST /api/approvals/{id}/approve` udfører handlingen som din brugerhandling og returnerer resultatet.
`POST /api/approvals/{id}/reject` afviser den.

## Risikoniveauer

| Niveau | Navn | Eksempler | Standard |
|---|---|---|---|
| 0 | READ | søgning, læse filer, kalender | tilladt |
| 1 | WRITE_LOCAL | oprette opgave, gemme minde, oprette dokument | tilladt (kræver godkendelse hvis konteksten er "tainted") |
| 2 | MODIFY | skrive filer, køre tests, oprette kalenderaftaler | kræver godkendelse (kan slås til) |
| 3 | EXTERNAL | POST til eksterne API'er | kræver altid godkendelse |
| 4 | CONSEQUENTIAL | økonomi, juridisk, masseletning | kræver altid godkendelse |
| 5 | SECURITY | rettigheder, nøgler, policy | aldrig tilladt for AI'en |

## Alle endpoints

| Metode | Sti | Modul |
|---|---|---|
| POST | `/api/auth/login` | auth |
| POST | `/api/auth/logout` | auth |
| GET | `/api/auth/me` | auth |
| POST | `/api/auth/password` | auth |
| GET | `/api/auth/sessions` | auth |
| POST | `/api/auth/sessions/revoke-all` | auth |
| GET | `/api/conversations` | chat |
| POST | `/api/conversations` | chat |
| GET | `/api/conversations/{cid}` | chat |
| PATCH | `/api/conversations/{cid}` | chat |
| DELETE | `/api/conversations/{cid}` | chat |
| POST | `/api/conversations/{cid}/messages` | chat |
| GET | `/api/documents` | documents |
| POST | `/api/documents` | documents |
| GET | `/api/documents/{did}` | documents |
| PATCH | `/api/documents/{did}` | documents |
| GET | `/api/documents/{did}/download` | documents |
| DELETE | `/api/documents/{did}` | documents |
| GET | `/api/documents-search` | documents |
| POST | `/api/documents/{did}/summarize` | documents |
| POST | `/api/research` | documents |
| GET | `/api/research` | documents |
| DELETE | `/api/research/{rid}` | documents |
| GET | `/api/workspace/tree` | documents |
| GET | `/api/workspace/file` | documents |
| GET | `/api/memory` | memory |
| GET | `/api/memory/stats` | memory |
| POST | `/api/memory` | memory |
| PATCH | `/api/memory/{mid}` | memory |
| DELETE | `/api/memory/{mid}` | memory |
| GET | `/api/tasks` | planning |
| POST | `/api/tasks` | planning |
| PATCH | `/api/tasks/{tid}` | planning |
| DELETE | `/api/tasks/{tid}` | planning |
| GET | `/api/projects` | planning |
| POST | `/api/projects` | planning |
| PATCH | `/api/projects/{pid}` | planning |
| DELETE | `/api/projects/{pid}` | planning |
| GET | `/api/calendar/events` | planning |
| POST | `/api/calendar/events` | planning |
| DELETE | `/api/calendar/events/{eid}` | planning |
| POST | `/api/calendar/sync` | planning |
| GET | `/api/calendar/status` | planning |
| GET | `/api/overview` | system |
| GET | `/api/agents` | system |
| POST | `/api/agents/{key}/toggle` | system |
| GET | `/api/security/policy` | system |
| PUT | `/api/security/policy` | system |
| GET | `/api/security/audit` | system |
| GET | `/api/approvals` | system |
| POST | `/api/approvals/{aid}/approve` | system |
| POST | `/api/approvals/{aid}/reject` | system |
| GET | `/api/models` | system |
| POST | `/api/models` | system |
| PATCH | `/api/models/{mid}` | system |
| DELETE | `/api/models/{mid}` | system |
| PUT | `/api/models/preferences` | system |
| GET | `/api/models/ollama` | system |
| POST | `/api/models/ollama/pull` | system |
| GET | `/api/models/usage` | system |
| GET | `/api/secrets` | system |
| PUT | `/api/secrets` | system |
| DELETE | `/api/secrets/{name}` | system |
| GET | `/api/automations` | system |
| POST | `/api/automations` | system |
| PUT | `/api/automations/{aid}` | system |
| DELETE | `/api/automations/{aid}` | system |
| POST | `/api/automations/{aid}/run` | system |
| GET | `/api/automations/{aid}/runs` | system |
| GET | `/api/notifications` | system |
| POST | `/api/notifications/read-all` | system |
| GET | `/api/backups` | system |
| POST | `/api/backups` | system |
| POST | `/api/voice/transcribe` | system |
| POST | `/api/voice/speak` | system |
| GET | `/api/voice/status` | system |
| POST | `/api/maintenance/reindex` | system |
| GET | `/api/health` | main |
