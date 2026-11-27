# Arkitektur

```
┌────────────── Browser / mobil (PWA) ──────────────┐
│ Next.js 15 · React 19 · TypeScript · Tailwind      │
│ 15 sektioner · SSE-chat · stemmemotor (VAD)        │
└──────────────┬────────────────────────────────────┘
               │ HTTPS (Tailscale/Caddy) · httpOnly-cookie
┌──────────────▼──────────── FastAPI (Python) ─────────────────────────────┐
│ api/routes   auth · chat · memory · planning · documents · system         │
│ services     assistant · calendar(CalDAV) · automation(APScheduler)       │
│              notify(ntfy/SMTP) · voice(Whisper/Piper) · backup · audit    │
│ agents       orkestrator → 8 specialagenter → værktøjsloop                │
│ tools        framework(policy+godkendelse) · builtin · sandbox · web      │
│ llm          base · providers(Ollama/OpenAI/Anthropic) · router · registry│
│ memory       scoring · service · vectorstore                              │
│ core         config · security · policy · injection                       │
└──────┬──────────────┬───────────────┬──────────────┬─────────────────────┘
   PostgreSQL       Qdrant          Ollama         SearXNG
 (alt strukturelt) (vektorer)   (lokale modeller) (websøgning)
```

## Dataflow for en chatbesked

1. Brugerbeskeden gemmes. Relevante minder hentes (semantisk søgning, rangeret efter lighed, vigtighed og friskhed)
   og lægges sammen med fastgjorte minder ind i systemprompten.
2. **Orkestratoren** spørger en lille lokal model (JSON-tilstand), om beskeden skal besvares direkte, af én agent
   eller af flere agenter parallelt.
3. Hver **agent** kører et værktøjsloop. Modellen svarer enten med `{"tool": ..., "args": ...}` eller med det endelige
   svar. Protokollen er udbyder-uafhængig, så den virker med alle lokale modeller.
4. Hvert værktøjskald går gennem **policy-motoren** og bliver tilladt, sendt til godkendelse eller afvist. Det logges
   i aktivitetsloggen. Ubetroede resultater markerer konteksten som tainted.
5. Svaret streames til browseren (SSE) og gemmes med metadata: agenter, model, kilder og værktøjer.
6. I baggrunden udtrækker en lokal model nye minder fra samtalen og opdaterer eller erstatter eksisterende minder.

## Modelvalg

`llm/router.py` er en ren funktion, så den kan testes:

* kompleksitet 1–2 → `local_small`, kompleksitet 3 → `local_large`, kodeopgaver → `local_code`
* kompleksitet 4–5 → billigste `cloud`, men kun hvis månedens forbrug (tabellen `usage`) er under budgettet
* hvis en model ikke svarer, bruges næste mulighed; cloud bruges aldrig når budgettet er nået
* manuelt valg pr. besked og "foretræk cloud" i indstillingerne

**Tilføj en ny udbyder:** implementér `LLMProvider` (`chat` + `stream`) i `llm/providers.py` og registrér den i
`PROVIDERS`. **Tilføj en ny model:** via UI'et, uden kodeændringer.

## Hukommelse

* Postgres er kilden til sandhed. Qdrant er et indeks, som kan genopbygges (`POST /api/maintenance/reindex`).
* Typer: preference, fact, project, decision, plan, person, task.
* Korttid → langtid: præferencer, beslutninger og personer gemmes straks permanent. Andre minder forfremmes ved
  høj vigtighed (≥ 0,7) eller efter 3 opslag. Ellers udløber de efter 14 dage.
* Nye minder kan erstatte gamle (`superseded_by`), så modsigelser ikke hober sig op.
* Hvis vektorsøgningen fejler, falder systemet tilbage til tekstsøgning.

## Udvidelse

| Vil du… | Gør sådan |
|---|---|
| tilføje en agent | ny `AgentDef` i `agents/definitions.py` |
| tilføje et værktøj | funktion med `@reg(...)` i `tools/builtin.py`, vælg korrekt `Risk` |
| tilføje en automatiseringstype | ny gren i `services/automation.run_automation` + `KINDS` |
| ændre databasen | ret `db/models.py`, kør `alembic revision --autogenerate -m "…"` |
| tilføje en dokumenttype | ny gren i `documents/parsers.parse_bytes` |
