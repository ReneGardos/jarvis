# Sikkerhedsmodel

Jarvis har adgang til din kalender, dine dokumenter, dine kodeprojekter og internettet. Sikkerheden er derfor bygget
ind i arkitekturen og ikke kun i AI'ens instruktioner.

## Grundprincipper

1. **AI'en kan aldrig ændre sine egne rettigheder.** Der findes intet værktøj til policy, nøgler eller agentstyring.
   Disse ændringer kan kun ske via API-endpoints, som kræver dit login. Policy-motoren afviser desuden alt på
   niveau `SECURITY`, når handlingen kommer fra en agent (`app/core/policy.py`, testet i `tests/test_core.py`).
2. **Godkendelse før konsekvens.** Eksterne kald, økonomi og juridiske handlinger kræver altid din godkendelse, også
   selvom du hæver grænsen for automatisk tilladelse. Grænsen kan højst sættes til `MODIFY`.
3. **Taint tracking mod prompt injection.** Når indhold fra internettet, dokumenter eller filer kommer ind i en samtale,
   markeres konteksten som *tainted*. Derefter kræver alle skrivende handlinger godkendelse i resten af turen. En
   ondsindet webside kan altså ikke få Jarvis til at slette filer eller sende data videre uden at du ser det.
4. **Ubetroet indhold afgrænses.** Webindhold, dokumenter og filer pakkes ind i afgrænsere med tilfældigt navn, som
   indholdet ikke kan forfalske, og modellen instrueres i at behandle det som data. Typiske injektionsmønstre (dansk og
   engelsk) og usynlige styretegn flagges.
5. **Hver agent har kun sine egne værktøjer.** Research-agenten kan ikke skrive filer, og Finance-agenten kan ikke
   søge i dine kodeprojekter. Det håndhæves i agent-loopet og ikke kun i prompten.

## Konkrete beskyttelser

| Område | Beskyttelse |
|---|---|
| Login | scrypt-hash (N=2¹⁷), låsning efter 5 forkerte forsøg, JWT bundet til en session der kan tilbagekaldes, httpOnly-cookie med SameSite=Strict |
| API-nøgler | Fernet-krypteret (AES-128-CBC + HMAC) i databasen, vises kun maskeret, redigeres ud af logs |
| Filadgang | Kun under godkendte rødder; symlinks og `..` opløses og afvises; `.env`, SSH-nøgler og credentials blokeres; automatisk backup før skrivning |
| Kommandoer | Fast tilladelsesliste, ingen shell, ingen kædning/omdirigering, minimalt miljø (ingen hemmeligheder arves), timeout |
| Internet | SSRF-beskyttelse: interne IP'er (router, database, cloud-metadata) blokeres, også efter redirects |
| Netværk | Alle tjenester binder kun til localhost; Qdrant kræver API-nøgle; HTTPS via Tailscale eller Caddy med HSTS |
| Browser | Sikkerhedsheaders (X-Frame-Options DENY, nosniff, no-referrer, begrænset Permissions-Policy), CORS begrænset til din frontend |
| Revision | Alle logins, værktøjskald (med beslutning), godkendelser og sikkerhedsændringer logges i aktivitetsloggen |
| Backup | Krypteret med master key, natlig rotation (14 stk.) |

## Hvad du selv skal gøre

* Brug en stærk, unik adgangskode og gem `.env` sikkert.
* Eksponér ikke port 8000/3000 direkte mod internettet – brug Tailscale eller Caddy.
* Giv kun Developer-agenten adgang til de projektmapper den skal bruge (`WORKSPACE_HOST_PATH`).
* Gennemgå *Godkendelser* omhyggeligt – især når en anmodning stammer fra en samtale med webindhold.
* Hold systemet opdateret (`git pull && docker compose up -d --build`).

## Kendte begrænsninger

* Heuristisk injektionsdetektion kan omgås. Den egentlige beskyttelse er taint tracking og godkendelser.
* Lokale modeller følger instruktioner mindre stabilt end store cloudmodeller. Godkendelseslaget er derfor
  uafhængigt af modellen.
* Systemet er bygget til én bruger. Hvis flere personer skal bruge det, kræver det adskillelse af data pr. bruger.
