# Installationsvejledning

## 1. Hardware og budget

Jarvis kører på din egen maskine. Lokale modeller er gratis at bruge; det er hardwaren der bestemmer, hvor gode de kan være.

| Opsætning | Eksempel | Lokale modeller | Bemærkning |
|---|---|---|---|
| Minimum | Mini-PC, 16 GB RAM, ingen GPU | `qwen2.5:3b` / `7b` (langsomt) | Brug cloud til tunge opgaver |
| Anbefalet | Mac mini M4 med 24–32 GB, eller PC med RTX 3060 12 GB | `qwen2.5:7b` + `14b`, `qwen2.5-coder:7b` | God balance |
| Kraftig | RTX 4090 24 GB / Mac Studio 64 GB+ | `qwen2.5:32b`, `llama3.3:70b` (Q4) | Næsten ingen cloud nødvendig |

**Månedlig drift (500–1.000 kr):** strøm til en maskine der kører 24/7 koster typisk 50–150 kr. Sæt cloudbudgettet
(`CLOUD_BUDGET_DKK_MONTH`) til fx 300–400 kr. Routeren skifter automatisk til lokale modeller, når loftet er nået.
SearXNG, Whisper, Piper, Postgres og Qdrant er gratis og kører lokalt.

## 2. Installation (Linux, macOS eller Windows med WSL2)

Forudsætninger: Docker og Docker Compose v2, Python 3 og `curl`.

```bash
git clone <dit-repo> jarvis && cd jarvis
./scripts/install.sh
```

Scriptet:
1. genererer stærke hemmeligheder i `.env` (rettigheder 600),
2. spørger efter din e-mail og adgangskode,
3. starter Postgres, Qdrant, Ollama, SearXNG, backend og frontend,
4. henter de lokale modeller og de danske/engelske stemmer,
5. fjerner adgangskoden fra `.env` igen.

Åbn derefter **http://localhost:3000** og log ind.

### NVIDIA-GPU
Installer *NVIDIA Container Toolkit* og fjern kommentarerne under `ollama.deploy` i `docker-compose.yml`.

### Mac (Apple Silicon)
Docker på Mac kan ikke bruge GPU'en. For fuld hastighed: installer Ollama direkte (`brew install ollama`,
`ollama serve`), fjern `ollama`-tjenesten fra compose-filen og sæt `OLLAMA_URL=http://host.docker.internal:11434`
under `backend.environment`.

## 3. Konfiguration af integrationer

Alle værdier ligger i `.env`. Genstart backend efter ændringer: `docker compose restart backend`.

### Cloudmodeller (valgfrit)
* **Anthropic:** opret nøgle på console.anthropic.com → `ANTHROPIC_API_KEY=` (eller indsæt den under *Modeller → API-nøgler*).
* **OpenAI:** platform.openai.com → `OPENAI_API_KEY=`.
* Nøgler fra `.env` flyttes ved opstart krypteret ind i databasen, og modellerne aktiveres. Du kan derefter fjerne dem fra `.env`.
* Andre udbydere (Groq, OpenRouter, Mistral, vLLM, LM Studio): *Modeller → Tilføj model*, udbyder `openai_compatible`, sæt base-URL og nøglenavn.
* Opdatér priserne pr. million tokens i UI'et, så budgetloftet regnes korrekt.

### Apple Kalender (iCloud)
1. Gå til **appleid.apple.com → Log ind og sikkerhed → App-specifikke adgangskoder** og opret én kaldet "Jarvis".
2. Sæt i `.env`:
   ```
   CALDAV_URL=https://caldav.icloud.com
   CALDAV_USERNAME=dit-apple-id@icloud.com
   CALDAV_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
3. Kalenderen synkroniseres hvert 15. minut og ved klik på *Synk*. Aftaler oprettet af Jarvis lægges i din første iCloud-kalender.

Google Kalender, Nextcloud og Fastmail virker også via CalDAV (Google: `https://apidata.googleusercontent.com/caldav/v2/<email>/events` med app-adgangskode).

### Påmindelser på mobilen (ntfy)
1. Installer appen **ntfy** (iOS/Android).
2. Abonnér på emnet i `NTFY_TOPIC` (genereret af `gen_secrets.py` – hold det hemmeligt).
3. Vil du helt undgå ntfy.sh, kan du selv hoste ntfy og ændre `NTFY_URL`.

### E-mail (valgfrit)
Udfyld `SMTP_*` og `NOTIFY_EMAIL`. Gmail kræver en app-adgangskode.

### Internetsøgning
SearXNG kører lokalt og søger på Google, Bing, DuckDuckGo, Wikipedia, GitHub og Stack Overflow. Hvis Google
begrænser dig, kan du supplere med Brave Search API (gratis kvote): `BRAVE_API_KEY=`.

### Projektmapper (Developer-agenten)
Sæt `WORKSPACE_HOST_PATH=/sti/til/dine/projekter`. Mappen monteres som `/workspace`. AI'en kan læse alt
undtagen `.env`, SSH-nøgler og lignende; skrivning og kørsel af tests kræver din godkendelse, og der tages backup
(`.jarvis-bak`) før hver ændring. Kun en fast liste af kommandoer er tilladt (pytest, npm test/build/lint, tsc, git status/diff/log).

## 4. Adgang fra mobil og udefra

Stemmefunktionen kræver HTTPS på mobil (browsere giver kun mikrofonadgang på sikre forbindelser).

**Anbefalet: Tailscale** (gratis, ingen åbne porte)
1. Installer Tailscale på serveren og telefonen.
2. Udgiv frontend og API på samme HTTPS-adresse:
   ```bash
   sudo tailscale serve --bg http://localhost:3000
   sudo tailscale serve --bg --set-path /api http://localhost:8000/api
   ```
3. Sæt `FRONTEND_ORIGIN=https://<maskinnavn>.<tailnet>.ts.net` og `PUBLIC_API_URL=` (tom = samme adresse) i `.env`,
   og byg igen: `docker compose up -d --build`.

**Alternativ: eget domæne med Caddy**
Sæt `JARVIS_DOMAIN=jarvis.ditdomæne.dk`, peg DNS på din IP, åbn port 80/443, sæt `PUBLIC_API_URL=https://jarvis.ditdomæne.dk`,
`FRONTEND_ORIGIN=https://jarvis.ditdomæne.dk` og kør `docker compose --profile https up -d --build`.

På iPhone: åbn siden i Safari → Del → *Føj til hjemmeskærm* for en app-lignende oplevelse.

## 5. Drift

| Opgave | Kommando |
|---|---|
| Status | `docker compose ps` og `curl localhost:8000/api/health` |
| Logs | `docker compose logs -f backend` |
| Opdatering | `git pull && docker compose up -d --build` (databasemigrationer køres automatisk) |
| Backup nu | `./scripts/backup.sh` eller knappen i Systemindstillinger |
| Gendannelse | `./scripts/restore.sh data/backups/jarvis-….tar.gz.enc` |
| Ny lokal model | *Modeller → Download lokal model*, derefter *Tilføj model* |
| Kør tests | `docker compose exec backend pytest -q` |

**Vigtigt:** Backups er krypteret med `JARVIS_MASTER_KEY`. Gem en kopi af `.env` et sikkert sted (fx en
adgangskodemanager) – uden nøglen kan backups ikke gendannes. Kopiér `data/backups` til en ekstern disk eller
cloud-lager regelmæssigt (fx med `rclone`).

## 6. Fejlfinding

* **"Ingen AI-modeller er tilgængelige"** – kør `./scripts/pull_models.sh` og tjek `docker compose logs ollama`.
* **Hukommelse/dokumentsøgning tom** – embedding-modellen mangler: `docker compose exec ollama ollama pull nomic-embed-text`, derefter *Genindeksér søgning*.
* **Stemme svarer ikke** – kør `./scripts/download_voices.sh`; på mobil kræves HTTPS.
* **Kalender synker ikke** – tjek app-specifik adgangskode og `docker compose logs backend | grep calendar`.
