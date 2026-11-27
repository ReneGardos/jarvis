# Jarvis Lite – 100 % lokal AI-assistent i browseren

Ingen server og ingen cloud-AI. Sprogmodellen kører på enhedens grafikchip (WebGPU via WebLLM), talegenkendelsen er
Whisper (transformers.js), oplæsning sker med enhedens egne stemmer, og alle data ligger i browserens IndexedDB.

**Funktioner:** Bygningskonstruktør-agent med BR18- og tømrerviden · 8 agenter · vidensbase du træner selv
(dokumenter, egne fakta, rettelser) · eksport af træningsdata (JSONL) · byggeberegnere (U-værdi, trappe,
skillevæg, tag, dagslys, ventilation, CO₂) · kodeværksted med live-forhåndsvisning og AI-programmør · opgaver med
påmindelser og .ics · hukommelse · stemme med wake word · backup/gendannelse · installérbar som app (PWA).

**Krav:** en browser med WebGPU: Chrome/Edge (computer og Android) eller Safari på iOS/iPadOS/macOS 26 eller nyere.
Første gang hentes modellen (0,5–5 GB). Derefter virker appen offline.

**Kør lokalt:** `python3 -m http.server 8080` i denne mappe → http://localhost:8080
**Tests:** `node --test tests/lite.test.js`
