# Jarvis Lite – 100 % lokal AI-assistent i browseren

Ingen server og ingen cloud-AI. Sprogmodellen kører på enhedens grafikchip (WebGPU via WebLLM), talegenkendelsen er
Whisper (transformers.js), oplæsning sker med enhedens egne stemmer, og alle data ligger i browserens IndexedDB.

**Funktioner:**
- **CAD/tegning:** AI-beskrivelse → præcis bygningsmodel · 2D-plantegning · 3D-visning (three.js) · eksport til **DXF (2D+3D), IFC4 og OBJ** til AutoCAD, Revit, BricsCAD, ArchiCAD · A3-print · BR18-tjek.
- **Bygningskonstruktør** med BR18- og tømrerviden · byggeberegnere (U-værdi, trappe, skillevæg, tag, dagslys, ventilation, CO₂).
- **10 agenter** (konstruktør, personlig, planlægning, research, tekstforfatter, programmør, forretning, marketing, økonomi, dokument).
- **Kodeværksted:** fulde webprojekter, filer, live-forhåndsvisning, AI-programmør der foreslår hele filer, **fanger fejl og retter dem**, åbn/gem i rigtige mapper, ZIP.
- **Research:** Wikipedia + CVR (virksomhedsregister), med kilder.
- **Træning:** vidensbase (dokumenter, egne fakta, rettelser), eksport af træningsdata (JSONL).
- Hukommelse · stemme med wake word · billed-upload (vision) · PDF-eksport · opgaver med påmindelser/.ics · backup · installérbar som app (PWA).

**Krav:** en browser med WebGPU: Chrome/Edge (computer og Android) eller Safari på iOS/iPadOS/macOS 26 eller nyere.
Første gang hentes modellen (0,5–5 GB). Derefter virker appen offline.

**Kør lokalt:** `python3 -m http.server 8080` i denne mappe → http://localhost:8080
**Tests:** `node --test tests/lite.test.js`
