// Kerne: lokal lagring (IndexedDB), lokal AI-motor (WebLLM/WebGPU), vidensøgning og agenter.
import { buildIndex, chunk, search } from "./search.js";
import { SEED, SEED_VERSION } from "./knowledge/br18.js";

export const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2";
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export { esc } from "./md.js";

// ---------------- Lagring ----------------
const DB_NAME = "jarvis-lite";
let dbp;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function kvGet(key) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction("kv").objectStore("kv").get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function kvSet(key, val) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export const KEYS = ["settings", "conversations", "memories", "tasks", "knowledge", "feedback", "projects"];
export const state = {
  settings: { model: "", codeModel: "", lang: "da", agent: "konstruktor", autoMemory: true, voiceName: "", seedVersion: 0, whisper: "Xenova/whisper-base" },
  conversations: [], memories: [], tasks: [], knowledge: [], feedback: [], projects: [],
};
const timers = {};
export function save(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => kvSet(key, state[key]).catch((e) => toast("Kunne ikke gemme: " + e.message)), 250);
  if (key === "knowledge" || key === "memories") invalidateIndex();
}
export async function loadAll() {
  for (const k of KEYS) {
    const v = await kvGet(k);
    if (v !== undefined) state[k] = k === "settings" ? { ...state.settings, ...v } : v;
  }
  if ((state.settings.seedVersion || 0) < SEED_VERSION) {
    // Installer/opdatér startviden uden at røre brugerens egen viden
    state.knowledge = state.knowledge.filter((k) => k.kind !== "seed");
    state.knowledge.unshift(...SEED.map((s) => ({ ...s, id: "seed-" + uid(), kind: "seed", createdAt: Date.now() })));
    state.settings.seedVersion = SEED_VERSION;
    save("knowledge"); save("settings");
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
export async function exportAll() {
  const out = { app: "jarvis-lite", version: 1, exported: new Date().toISOString() };
  for (const k of KEYS) out[k] = state[k];
  return out;
}
export async function importAll(data) {
  if (data?.app !== "jarvis-lite") throw new Error("Det er ikke en Jarvis-backup");
  for (const k of KEYS) if (data[k] !== undefined) { state[k] = data[k]; await kvSet(k, data[k]); }
  invalidateIndex();
}

// ---------------- UI-hjælpere ----------------
let toastT;
export function toast(msg, ms = 3000) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms);
}
export function progress(pct, text) {
  const p = $("#progress");
  if (pct === null) { p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  $("#progressBar").style.width = Math.round(pct * 100) + "%";
  $("#progressText").textContent = text || "";
}
export function download(name, content, type = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------- Lokal AI-motor ----------------
export const llm = { engine: null, model: "", loading: false, webllm: null, busy: false, queue: Promise.resolve() };

export async function webgpuInfo() {
  if (!("gpu" in navigator)) return { ok: false, reason: "Browseren understøtter ikke WebGPU. Brug Chrome eller Edge (computer/Android) eller Safari på iOS 26 / macOS 26 eller nyere." };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { ok: false, reason: "Der blev ikke fundet en kompatibel GPU." };
    return { ok: true, f16: a.features.has("shader-f16"), maxBuffer: a.limits.maxBufferSize };
  } catch (e) { return { ok: false, reason: String(e.message || e) }; }
}

async function lib() { return (llm.webllm ||= await import(WEBLLM_URL)); }

const PREFERRED = [/^Qwen2\.5-3B-Instruct/, /^gemma-2-2b-it/, /^Qwen2\.5-1\.5B-Instruct/, /^Llama-3\.2-3B-Instruct/, /^Qwen2\.5-7B-Instruct/,
  /^Llama-3\.1-8B-Instruct/, /^Phi-3\.5-mini-instruct/, /^Qwen2\.5-0\.5B-Instruct/];
const CODER = [/^Qwen2\.5-Coder-7B-Instruct/, /^Qwen2\.5-Coder-3B-Instruct/, /^Qwen2\.5-Coder-1\.5B-Instruct/];

/** Liste over relevante modeller fra WebLLM's katalog, med anslået hukommelsesbehov. */
export async function modelCatalog() {
  const w = await lib();
  const gpu = await webgpuInfo();
  const suffix = gpu.f16 ? "q4f16_1-MLC" : "q4f32_1-MLC";
  const all = w.prebuiltAppConfig.model_list.filter((m) => m.model_id.endsWith(suffix));
  const pick = (patterns, kind) => patterns.flatMap((p) => all.filter((m) => p.test(m.model_id)).slice(0, 1))
    .map((m) => ({ id: m.model_id, vram: Math.round(m.vram_required_MB || 0), kind }));
  return [...pick(PREFERRED, "chat"), ...pick(CODER, "code")];
}

export function recommendedModel(cat, kind = "chat") {
  const mem = navigator.deviceMemory || 4; // GB (afrundet, kun Chrome)
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const budget = mobile ? 2500 : mem >= 8 ? 6000 : 3500;
  const list = cat.filter((m) => m.kind === kind);
  return (list.find((m) => m.vram && m.vram <= budget) || list[list.length - 1] || {}).id || "";
}

export async function loadModel(modelId) {
  if (!modelId) throw new Error("Vælg en model");
  if (llm.model === modelId && llm.engine) return;
  const gpu = await webgpuInfo();
  if (!gpu.ok) throw new Error(gpu.reason);
  const w = await lib();
  llm.loading = true;
  progress(0, "Forbereder model…");
  try {
    const cb = (p) => progress(p.progress, (p.text || "").replace("Fetching param cache", "Henter model (kun første gang)").slice(0, 120));
    if (llm.engine) {
      await llm.engine.reload(modelId);
    } else {
      llm.engine = await w.CreateWebWorkerMLCEngine(new Worker(new URL("./llm-worker.js", import.meta.url), { type: "module" }),
        modelId, { initProgressCallback: cb });
    }
    llm.engine.setInitProgressCallback?.(cb);
    llm.model = modelId;
  } finally {
    llm.loading = false;
    progress(null);
  }
  document.dispatchEvent(new CustomEvent("model-changed"));
}

const stripThink = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();

/** Kører én forespørgsel ad gangen (motoren er enkelttrådet). */
export function generate(messages, { onToken, temperature = 0.5, max_tokens = 1500, json = false } = {}) {
  const run = async () => {
    if (!llm.engine) throw new Error("Ingen model indlæst. Tryk på modelknappen øverst.");
    llm.busy = true; document.body.classList.add("busy"); $("#orb")?.classList.add("busy");
    try {
      const req = { messages, temperature, max_tokens, stream: true, stream_options: { include_usage: true } };
      if (json) req.response_format = { type: "json_object" };
      const chunks = await llm.engine.chat.completions.create(req);
      let raw = "";
      for await (const c of chunks) {
        const d = c.choices?.[0]?.delta?.content || "";
        if (d) { raw += d; onToken?.(stripThink(raw)); }
      }
      return stripThink(raw);
    } finally {
      llm.busy = false; $("#orb")?.classList.remove("busy");
    }
  };
  const p = llm.queue.then(run, run);
  llm.queue = p.catch(() => {});
  return p;
}
export function stopGenerating() { try { llm.engine?.interruptGenerate(); } catch {} }

// ---------------- Vidensøgning ("træning" via din egen vidensbase) ----------------
let index = null;
export function invalidateIndex() { index = null; }
function getIndex() {
  if (index) return index;
  const docs = [];
  for (const k of state.knowledge) {
    if (k.disabled) continue;
    const boost = k.kind === "correction" ? 1.8 : k.kind === "fact" ? 1.4 : 1;
    chunk(k.text, 900, 150).forEach((c, i) => docs.push({ id: `${k.id}:${i}`, kid: k.id, title: k.title, source: k.source, kind: k.kind,
      text: `${k.title}\n${c}`, boost }));
  }
  index = buildIndex(docs);
  return index;
}
export function searchKnowledge(q, k = 5) {
  const seen = new Set();
  return search(getIndex(), q, k * 2).filter((h) => (seen.has(h.id) ? false : seen.add(h.id))).slice(0, k);
}
export function searchMemories(q, k = 8) {
  const docs = state.memories.map((m) => ({ id: m.id, text: m.content, boost: 1 + (m.importance || 0.5) }));
  const hits = search(buildIndex(docs), q, k).map((h) => state.memories.find((m) => m.id === h.id));
  const pinned = state.memories.filter((m) => m.pinned);
  return [...new Map([...pinned, ...hits].filter(Boolean).map((m) => [m.id, m])).values()].slice(0, k + pinned.length);
}

// ---------------- Agenter ----------------
const BASE = "Du er Jarvis, en personlig AI-assistent der kører helt lokalt på brugerens egen enhed. Svar på dansk medmindre brugeren skriver på et andet sprog. " +
  "Vær konkret og praktisk. Opfind aldrig fakta, tal eller paragraffer – hvis du ikke ved det, så sig det.";
export const AGENTS = {
  konstruktor: { name: "Bygningskonstruktør", icon: "📐", useKnowledge: true, tasks: true,
    system: BASE + " Du er en erfaren dansk bygningskonstruktør og tømrer. Du kender BR18, tømrerfaget, materialer, konstruktioner, " +
      "byggesagsforløb, mængdeberegning, tilbud og byggeledelse. Når du henviser til krav, så angiv paragraf og kilde fra vidensbasen. " +
      "Hvis vidensbasen ikke dækker spørgsmålet, så sig at kravet skal kontrolleres på bygningsreglementet.dk. Henvis bærende konstruktioner " +
      "til en statiker. Lav ikke selv lange beregninger i hovedet – henvis til beregnerne under fanen 'Byg' (U-værdi, trappe, væg, tag, dagslys, ventilation)." },
  personal: { name: "Personlig assistent", icon: "🙂", useKnowledge: true, tasks: true,
    system: BASE + " Du hjælper med hverdag, planlægning, beslutninger og opgaver. Strukturér muligheder med fordele og ulemper." },
  planning: { name: "Planlægning", icon: "🗓️", tasks: true,
    system: BASE + " Du er ekspert i tidsstyring. Lav realistiske dags- og ugeplaner med pauser ud fra brugerens opgaver og deadlines." },
  research: { name: "Research", icon: "🔎", useKnowledge: true, research: true,
    system: BASE + " Du er researcher. Du får ubetroede kilder fra internettet (fx Wikipedia) og brugerens vidensbase. " +
      "Sammenfat sagligt på dansk, skeln mellem fakta og vurdering, og angiv kilder med titel. Hvis kilderne ikke rækker, så sig det." },
  tekst: { name: "Tekstforfatter", icon: "✍️", useKnowledge: true,
    system: BASE + " Du er en dygtig dansk tekstforfatter. Skriv klart, korrekt og i den tone og længde brugeren beder om " +
      "(fx tilbud, brev, e-mail, hjemmesidetekst, opslag, ansøgning, referat). Spørg kort ind, hvis formål eller modtager mangler." },
  developer: { name: "Programmør", icon: "⌨️", code: true,
    system: BASE + " Du er en erfaren webudvikler (HTML, CSS, JavaScript, React, Next.js, Python). Skriv komplet, fungerende kode. " +
      "Når du ændrer eller opretter en fil i projektet, så skriv HELE filen i dette format:\n### FILE: sti/filnavn.ext\n```sprog\n...hele indholdet...\n```\n" +
      "Forklar kort hvad du har ændret. Hold hjemmesider responsive og tilgængelige." },
  business: { name: "Forretning", icon: "💼", useKnowledge: true,
    system: BASE + " Du er strategikonsulent for små virksomheder i byggebranchen: tilbud, prissætning, kunder, økonomi og vækst." },
  marketing: { name: "Marketing", icon: "📣",
    system: BASE + " Du er marketing- og SEO-specialist. Skriv tekster til hjemmesider, sociale medier og annoncer på godt dansk." },
  finance: { name: "Økonomi", icon: "💰", useKnowledge: true,
    system: BASE + " Du hjælper med budgetter, kalkulation og økonomi. Vis udregninger trin for trin. Du giver ikke investeringsrådgivning." },
  document: { name: "Dokumenter", icon: "📄", useKnowledge: true,
    system: BASE + " Du læser, sammenfatter og skriver dokumenter: referater, tilbud, breve, beskrivelser og rapporter." },
};

const TOOL_HELP = "Du kan foreslå handlinger, som brugeren skal bekræfte. Skriv i så fald en JSON-blok:\n" +
  '```json\n{"tool": "task_create", "title": "...", "due": "YYYY-MM-DDTHH:MM"}\n```\n' +
  'eller {"tool": "memory_save", "content": "..."} eller {"tool": "knowledge_save", "title": "...", "text": "..."}. Brug det kun når det er relevant.';

export function buildContext(agentKey, userText, history, extra = "") {
  const a = AGENTS[agentKey] || AGENTS.konstruktor;
  const now = new Date();
  const parts = [a.system, `I dag er ${now.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, kl. ${now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}.`];
  const mems = searchMemories(userText, 6);
  if (mems.length) parts.push("Det du husker om brugeren:\n" + mems.map((m) => "- " + m.content).join("\n"));
  let sources = [];
  if (a.useKnowledge) {
    sources = searchKnowledge(userText + " " + history.slice(-2).map((m) => m.content).join(" ").slice(0, 400), 5);
    if (sources.length) parts.push("Vidensbase (brugerens egen viden og rettelser har forrang). Henvis til titlen når du bruger den:\n" +
      sources.map((s, i) => `[${i + 1}] ${s.title}${s.kind === "correction" ? " (BRUGERENS RETTELSE – følg denne)" : ""}\n${s.text.slice(0, 900)}`).join("\n\n"));
  }
  if (a.tasks) {
    const open = state.tasks.filter((t) => !t.done).slice(0, 15);
    if (open.length) parts.push("Brugerens åbne opgaver:\n" + open.map((t) => `- ${t.title}${t.due ? ` (frist ${new Date(t.due).toLocaleString("da-DK")})` : ""}`).join("\n"));
    parts.push(TOOL_HELP);
  }
  if (extra) parts.push(extra);
  const messages = [{ role: "system", content: parts.join("\n\n") }, ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText }];
  return { messages, sources };
}

// ---------------- Handlinger i svar ----------------
export function parseActions(text) {
  const out = [];
  for (const m of text.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)) {
    try { const o = JSON.parse(m[1]); if (["task_create", "memory_save", "knowledge_save"].includes(o.tool)) out.push(o); } catch {}
  }
  return out;
}
export function stripActions(text) { return text.replace(/```json\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/g, "").trim(); }

export function applyAction(a) {
  if (a.tool === "task_create") {
    state.tasks.unshift({ id: uid(), title: String(a.title || "Opgave").slice(0, 200), due: a.due ? new Date(a.due).toISOString() : null,
      priority: 2, done: false, createdAt: Date.now() });
    save("tasks"); return "Opgave oprettet";
  }
  if (a.tool === "memory_save") {
    state.memories.unshift({ id: uid(), content: String(a.content).slice(0, 500), importance: 0.7, createdAt: Date.now() });
    save("memories"); return "Gemt i hukommelsen";
  }
  if (a.tool === "knowledge_save") {
    state.knowledge.unshift({ id: uid(), kind: "fact", title: String(a.title || "Viden").slice(0, 200), text: String(a.text || ""), category: "Egen viden",
      source: "Lært i chat", createdAt: Date.now() });
    save("knowledge"); return "Tilføjet til vidensbasen";
  }
  return "";
}

// ---------------- Automatisk hukommelse ----------------
const EXTRACT = `Udtræk varige, nyttige oplysninger om BRUGEREN fra samtalen (præferencer, fakta om brugerens arbejde/firma/liv, projekter, beslutninger, planer, personer).
Ignorer småsnak og ting assistenten sagde. Svar KUN med JSON: {"memories": ["kort selvstændig sætning", ...]} – tom liste hvis intet.`;
export async function extractMemories(userText, answer) {
  if (!state.settings.autoMemory || userText.length < 15) return;
  try {
    const raw = await generate([{ role: "system", content: EXTRACT }, { role: "user", content: `BRUGER: ${userText}\nASSISTENT: ${answer.slice(0, 800)}` }],
      { temperature: 0.1, max_tokens: 200, json: true });
    const data = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    const existing = new Set(state.memories.map((m) => m.content.toLowerCase()));
    let n = 0;
    for (const c of (data.memories || []).slice(0, 3)) {
      if (typeof c === "string" && c.length > 8 && c.length < 300 && !existing.has(c.toLowerCase())) {
        state.memories.unshift({ id: uid(), content: c, importance: 0.5, auto: true, createdAt: Date.now() }); n++;
      }
    }
    if (n) { save("memories"); toast(`🧠 Husker ${n} ny${n > 1 ? "e" : ""} ting`); }
  } catch { /* hukommelse er best effort */ }
}
