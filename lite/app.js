// Jarvis Lite – app, navigation, chat, opgaver, viden, hukommelse og indstillinger.
import { md } from "./md.js";
import {
  $, $$, AGENTS, applyAction, buildContext, download, esc, exportAll, extractMemories, generate, importAll, llm, loadAll,
  loadModel, modelCatalog, parseActions, progress, recommendedModel, save, state, stopGenerating, stripActions, toast, uid, webgpuInfo,
} from "./core.js";
import { renderBuild } from "./build.js";
import { renderDrawing } from "./cad-ui.js";
import { renderVoice, stopVoice } from "./voice.js";
import { renderCode } from "./code.js";
import { gatherSources, sourcesPrompt, cvr, wikipedia } from "./research.js";
import { renderFunctionSheet, inlineCalc, runCalcTools, calcToolInstructions } from "./functions.js";

const view = () => $("#view");
let tab = "chat";

// ---------------- Navigation ----------------
const RENDER = { chat: renderChat, voice: renderVoice, build: renderBuild, tegning: () => renderDrawing(view()), code: renderCode, know: renderKnow, tasks: renderTasks, more: renderMore };
export function go(t) {
  if (tab === "voice" && t !== "voice") stopVoice();
  tab = t;
  const dockActive = ["know", "tasks", "more", "tegning", "code", "build"].includes(t) ? "menu" : t;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === dockActive));
  view().innerHTML = "";
  RENDER[t]();
  window.scrollTo(0, 0);
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (!b) return; if (b.dataset.tab === "menu") toggleSheet(); else go(b.dataset.tab); });
$("#sheet").addEventListener("click", (e) => { if (e.target.closest(".sheet-bg")) return toggleSheet(false); const b = e.target.closest("button[data-tab]"); if (b) { toggleSheet(false); go(b.dataset.tab); } });
function toggleSheet(open) { const s = $("#sheet"); const show = open ?? s.classList.contains("hidden"); s.classList.toggle("hidden", !show); }
$("#modelBtn").addEventListener("click", () => go("more"));
document.addEventListener("model-changed", updateHeader);
function updateHeader() {
  $("#modelBtn").textContent = llm.model ? llm.model.replace(/-q4f(16|32)_1-MLC$/, "") : "Indlæs model";
  $("#agentLabel").textContent = "· " + (AGENTS[state.settings.agent]?.name || "");
}

// ---------------- Chat ----------------
function currentConv() {
  let c = state.conversations.find((x) => x.id === state.settings.currentConv);
  if (!c) {
    c = { id: uid(), title: "Ny samtale", agent: state.settings.agent, messages: [], createdAt: Date.now() };
    state.conversations.unshift(c); state.settings.currentConv = c.id; save("settings"); save("conversations");
  }
  return c;
}

const STARTERS = {
  konstruktor: ["Hvad er kravet til U-værdi for ydervægge ved tilbygning?", "Hvor højt skal et værn ved en altan være?", "Lav en materialeliste til en 12 m² skillevæg", "Hvad skal jeg huske ved en tagudskiftning?"],
  personal: ["Planlæg min dag", "Hjælp mig med en svær beslutning", "Hvad husker du om mig?"],
  planning: ["Lav en ugeplan ud fra mine opgaver", "Hvad er mine vigtigste deadlines?"],
  research: ["Undersøg reglerne for at bygge en carport uden byggetilladelse", "Hvad siger man om radonsikring?"],
  tekst: ["Skriv et tilbud på en ny terrasse", "Skriv en forsidetekst til mit tømrerfirma", "Skriv en professionel mail til en kunde"],
  developer: ["Lav en hjemmeside til mit tømrerfirma", "Forklar forskellen på React og Next.js"],
  business: ["Hvordan prissætter jeg et tilbud på en tilbygning?", "Ideer til at få flere kunder"],
  marketing: ["Skriv en tekst til forsiden på mit tømrerfirmas hjemmeside", "Lav 5 opslag til Facebook"],
  finance: ["Lav et budget for en tilbygning på 30 m²", "Hvordan beregner jeg dækningsbidrag?"],
  document: ["Skriv et byggemødereferat", "Skriv et tilbud på en terrasse"],
};

export async function sendMessage(text, { conv = currentConv(), onToken, research, image } = {}) {
  const agent = conv.agent || state.settings.agent;
  let extra = "", webSources = [];
  if (AGENTS[agent]?.calc) extra = calcToolInstructions();
  if (research || AGENTS[agent]?.research) {
    onToken?.(""); // vis at noget sker
    try { webSources = await gatherSources(text); extra = [extra, sourcesPrompt(webSources)].filter(Boolean).join("\n\n"); } catch {}
  }
  const history = conv.messages
    .map((m) => m.role === "calc" ? { role: "assistant", content: m.result ? `(beregning) ${m.result}` : "" } : { role: m.role, content: m.content })
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content);
  const { messages, sources } = buildContext(agent, text, history, extra);
  if (image) messages[messages.length - 1].content = [{ type: "text", text }, { type: "image_url", image_url: { url: image } }];
  conv.messages.push({ role: "user", content: text, image, ts: Date.now() });
  if (conv.title === "Ny samtale") conv.title = text.slice(0, 50);
  const bot = { role: "assistant", content: "", ts: Date.now(), agent,
    sources: [...sources.map((s) => ({ title: s.title, source: s.source, kind: s.kind })),
      ...webSources.filter((w) => !w.error).map((w) => ({ title: w.title, source: w.url, kind: "web" }))] };
  conv.messages.push(bot);
  save("conversations");
  try {
    bot.content = await generate(messages, { onToken: (t) => { bot.content = t; onToken?.(t); } });
  } catch (e) {
    const hint = image ? " (billedforståelse kræver en vision-model – vælg en under Mere, hvis din enhed er kraftig nok)" : "";
    bot.content = (bot.content ? bot.content + "\n\n" : "") + "⚠️ " + e.message + hint;
  }
  const tooled = runCalcTools(bot.content);
  if (tooled.results.length) bot.content = [tooled.text, ...tooled.results.map((r) => `**Resultat (${r.tool}):** ${r.out}`)].filter(Boolean).join("\n\n");
  bot.model = llm.model;
  save("conversations");
  extractMemories(text, bot.content);
  return bot.content;
}

function renderChat() {
  const conv = currentConv();
  const agent = conv.agent || state.settings.agent;
  view().innerHTML = `
    <div class="toolbar">
      <button class="chip" id="agentChip" type="button" title="Skift assistent">${AGENTS[agent].icon} ${esc(AGENTS[agent].name)} ▾</button>
      <select id="convSel"><option value="">Samtaler…</option>${state.conversations.slice(0, 40).map((c) => `<option value="${c.id}" ${c.id === conv.id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select>
      <button class="btn sub sm" id="newConv">＋ Ny</button>
      <button class="btn ghost sm" id="delConv">Slet</button>
    </div>
    ${!llm.engine ? `<div class="warnbox">Ingen AI-model er indlæst endnu. <button class="btn sm" id="loadNow">Indlæs anbefalet model</button></div>` : ""}
    <div class="chat" id="chat"></div>
    <form class="composer" id="composer">
      <div id="fnChips" class="chips"></div>
      <div class="inner">
        <button class="btn sub fn-btn" id="fnBtn" type="button" title="Funktioner">＋</button>
        <textarea id="input" rows="1" placeholder="Skriv eller vælg en funktion (＋)…"></textarea>
        <button class="btn" id="sendBtn" type="submit">➤</button>
      </div>
      <div id="attach" class="inner" style="margin-top:4px"></div>
      <input type="file" id="imgIn" accept="image/*" hidden />
    </form>`;
  const chat = $("#chat");
  const draw = () => {
    if (conv.messages.length) { chat.innerHTML = ""; }
    else {
      const navn = state.settings.profile?.navn;
      const hour = new Date().getHours();
      const hej = hour < 10 ? "Godmorgen" : hour < 18 ? "Goddag" : "Godaften";
      const noGpu = !("gpu" in navigator);
      chat.innerHTML = `<div class="hero">
        <div class="hero-orb"></div>
        <div class="hero-title">${hej}${navn ? ", " + esc(navn) : ""}</div>
        <div class="hero-sub">${AGENTS[agent].icon} ${esc(AGENTS[agent].name)} · kører 100&nbsp;% privat på din enhed</div>
        ${noGpu ? `<div class="warnbox" style="margin-top:14px;text-align:left">Din browser mangler WebGPU, så AI-modellen kan ikke køre. Brug Chrome/Edge eller Safari på iOS&nbsp;26+/macOS&nbsp;26+.</div>`
          : !llm.engine ? `<button class="btn" id="heroLoad" style="margin-top:16px">⚡ Tænd Jarvis (hent model)</button>` : ""}
        <div class="hero-chips">${(STARTERS[agent] || []).map((s) => `<button class="starter" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        <div class="hero-hint muted">Tryk <b>＋</b> for funktioner: tegning, kode, beregnere, undersøg, vejr…</div>
      </div>`;
    }
    conv.messages.forEach((m, i) => chat.appendChild(bubble(m, i, conv)));
    $("#heroLoad")?.addEventListener("click", quickLoad);
  };
  draw();
  let researchNext = false;
  const updateChips = () => { $("#fnChips").innerHTML = researchNext ? `<span class="chip on">🔎 Undersøg aktiv <button class="x" id="rmResearch" style="padding:0 4px">✕</button></span>` : ""; const r = $("#rmResearch"); if (r) r.onclick = () => { researchNext = false; updateChips(); }; };
  const openFunctions = () => renderFunctionSheet((pick) => {
    if (pick.type === "agent") { conv.agent = pick.id; state.settings.agent = pick.id; save("settings"); save("conversations"); updateHeader(); renderChatAgain(); return; }
    const id = pick.id;
    if (id === "tegning" || id === "code") return go(id);
    if (id === "research") { researchNext = true; updateChips(); return; }
    if (id === "image") return $("#imgIn").click();
    conv.messages.push({ role: "calc", calc: id, ts: Date.now() }); save("conversations"); draw(); window.scrollTo(0, document.body.scrollHeight);
  });
  $("#fnBtn").onclick = openFunctions;
  $("#agentChip").onclick = openFunctions;
  $("#convSel").onchange = (e) => { if (e.target.value) { state.settings.currentConv = e.target.value; const c = state.conversations.find((x) => x.id === e.target.value); if (c?.agent) state.settings.agent = c.agent; save("settings"); updateHeader(); renderChatAgain(); } };
  $("#newConv").onclick = () => { state.settings.currentConv = null; renderChatAgain(); };
  $("#delConv").onclick = () => { if (confirm("Slet denne samtale?")) { state.conversations = state.conversations.filter((c) => c.id !== conv.id); state.settings.currentConv = null; save("conversations"); renderChatAgain(); } };
  $("#loadNow")?.addEventListener("click", quickLoad);
  chat.addEventListener("click", (e) => { const s = e.target.closest("[data-s]"); if (s) submit(s.dataset.s); });
  let pendingImg = null;
  $("#imgIn").onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 6e6) return toast("Billedet er for stort (maks 6 MB)");
    const rd = new FileReader();
    rd.onload = () => { pendingImg = rd.result; $("#attach").innerHTML = `<img src="${pendingImg}" style="height:46px;border-radius:8px" /> <button class="btn ghost sm" id="imgClr">Fjern</button>`; $("#imgClr").onclick = () => { pendingImg = null; $("#attach").innerHTML = ""; }; };
    rd.readAsDataURL(file);
  };
  const input = $("#input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !/Mobi/.test(navigator.userAgent)) { e.preventDefault(); submit(input.value); } });
  $("#composer").onsubmit = (e) => { e.preventDefault(); llm.busy ? stopGenerating() : submit(input.value); };

  async function submit(text) {
    text = text.trim();
    if (!text) return;
    if (!llm.engine) { await quickLoad(); if (!llm.engine) return; }
    input.value = ""; input.style.height = "auto";
    $("#sendBtn").textContent = "■";
    let node;
    const img = pendingImg; pendingImg = null; $("#attach").innerHTML = "";
    const useResearch = researchNext; researchNext = false; updateChips();
    await sendMessage(text, { conv, image: img, research: useResearch, onToken: () => {
      if (!node) { draw(); node = chat.lastElementChild; }
      const last = conv.messages[conv.messages.length - 1];
      node.querySelector(".content").innerHTML = md(stripActions(last.content));
      window.scrollTo(0, document.body.scrollHeight);
    } });
    $("#sendBtn") && ($("#sendBtn").textContent = "➤");
    draw();
    window.scrollTo(0, document.body.scrollHeight);
  }
  window.scrollTo(0, document.body.scrollHeight);
}
function renderChatAgain() { view().innerHTML = ""; renderChat(); }

let _saveT;
function bubble(m, i, conv) {
  if (m.role === "calc") { const host = document.createElement("div"); inlineCalc(m.calc, host, (t) => { m.result = t; clearTimeout(_saveT); _saveT = setTimeout(() => save("conversations"), 400); }); return host.firstElementChild || host; }
  const el = document.createElement("div");
  el.className = "msg " + (m.role === "user" ? "user" : "bot");
  if (m.role === "user") { el.innerHTML = (m.image ? `<img src="${m.image}" style="max-width:220px;border-radius:10px;display:block;margin-bottom:6px" />` : "") + `<span></span>`; el.querySelector("span").textContent = m.content; return el; }
  const actions = parseActions(m.content);
  el.innerHTML = `<div class="content">${md(stripActions(m.content)) || "…"}</div>
    ${actions.map((a, j) => `<div class="action">Forslag: <b>${esc(a.tool === "task_create" ? "Opret opgave" : a.tool === "memory_save" ? "Husk" : "Tilføj til viden")}</b> – ${esc(a.title || a.content || "")}
      ${a.due ? ` (${esc(new Date(a.due).toLocaleString("da-DK"))})` : ""} ${m.applied?.includes(j) ? `<span class="badge ok">Udført</span>` : `<button class="btn sm" data-apply="${j}">Udfør</button>`}</div>`).join("")}
    <div class="meta">
      ${m.sources?.length ? `<span>📚 ${m.sources.map((s) => esc(s.title.split(" – ")[0])).slice(0, 3).join(" · ")}</span>` : ""}
      <button data-good>${m.rating === 1 ? "👍 Godt" : "👍"}</button>
      <button data-fix>✏️ Ret svaret</button>
      <button data-speak>🔊</button>
      <button data-pdf>📄 PDF</button>
    </div>`;
  el.addEventListener("click", (e) => {
    const ap = e.target.closest("[data-apply]");
    if (ap) { const j = +ap.dataset.apply; toast(applyAction(actions[j])); (m.applied ||= []).push(j); save("conversations"); ap.outerHTML = `<span class="badge ok">Udført</span>`; }
    if (e.target.closest("[data-good]")) {
      m.rating = 1; save("conversations");
      const q = conv.messages[i - 1]?.content || "";
      state.feedback.push({ id: uid(), q, a: m.content, rating: 1, agent: m.agent, ts: Date.now() }); save("feedback");
      e.target.textContent = "👍 Godt"; toast("Tak – gemt som godt eksempel til træning");
    }
    if (e.target.closest("[data-fix]")) correct(conv, i);
    if (e.target.closest("[data-speak]")) speakText(stripActions(m.content));
    if (e.target.closest("[data-pdf]")) exportPdf(conv.messages[i - 1]?.content || "", stripActions(m.content));
  });
  return el;
}

function correct(conv, i) {
  const q = conv.messages[i - 1]?.content || "";
  const fixed = prompt("Skriv det korrekte svar. Jarvis bruger din rettelse fremover, når der spørges om noget lignende:", "");
  if (!fixed?.trim()) return;
  state.knowledge.unshift({ id: uid(), kind: "correction", title: "Rettelse: " + q.slice(0, 90), category: "Mine rettelser",
    text: `Spørgsmål: ${q}\nKorrekt svar: ${fixed.trim()}`, source: "Din rettelse", createdAt: Date.now() });
  state.feedback.push({ id: uid(), q, a: conv.messages[i].content, correction: fixed.trim(), rating: -1, agent: conv.messages[i].agent, ts: Date.now() });
  save("knowledge"); save("feedback");
  toast("✅ Lært! Rettelsen er gemt i din vidensbase");
}

export async function exportPdf(question, answer) {
  try {
    const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 180, left = 15; let y = 20;
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("Jarvis", left, y); y += 4;
    doc.setDrawColor(200); doc.line(left, y, left + W, y); y += 8;
    const block = (title, text, bold) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(120); doc.text(title, left, y); y += 5;
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(11); doc.setTextColor(20);
      for (const line of doc.splitTextToSize(text.replace(/[#*`>|]/g, ""), W)) {
        if (y > 282) { doc.addPage(); y = 20; }
        doc.text(line, left, y); y += 5.6;
      }
      y += 4;
    };
    if (question) block("Spørgsmål", question);
    block("Svar", answer);
    doc.setFontSize(8); doc.setTextColor(150);
    doc.text("Lavet lokalt med Jarvis · " + new Date().toLocaleString("da-DK"), left, 290);
    doc.save("jarvis-svar.pdf");
  } catch (e) { toast("⚠️ PDF kræver internet første gang: " + e.message); }
}

export function speakText(text) {
  const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>|]/g, "").slice(0, 3000));
  u.lang = state.settings.lang === "en" ? "en-GB" : "da-DK";
  const v = speechSynthesis.getVoices().find((x) => x.name === state.settings.voiceName) || speechSynthesis.getVoices().find((x) => x.lang.startsWith(u.lang.slice(0, 2)));
  if (v) u.voice = v;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return u;
}

let _loading = false;
async function quickLoad() {
  if (_loading || llm.engine) return;
  _loading = true;
  try {
    const cat = await modelCatalog();
    const id = state.settings.model || recommendedModel(cat);
    const gb = Math.round((cat.find((m) => m.id === id)?.vram || 2000) / 100) / 10;
    toast(`Henter Jarvis-model (~${gb} GB, kun første gang)…`, 5000);
    await loadModel(id);
    state.settings.model = id; save("settings");
    toast("Jarvis er klar ✓");
    if (tab === "chat") renderChatAgain();
  } catch (e) { toast("⚠️ " + e.message, 7000); }
  finally { _loading = false; }
}

// ---------------- Opgaver ----------------
function renderTasks() {
  const draw = () => {
    const open = state.tasks.filter((t) => !t.done).sort((a, b) => (a.priority - b.priority) || ((a.due || "9") > (b.due || "9") ? 1 : -1));
    const done = state.tasks.filter((t) => t.done).slice(0, 20);
    view().innerHTML = `<h2>Opgaver</h2>
      <div class="card"><div class="row">
        <input class="grow" id="tTitle" placeholder="Ny opgave…" />
        <select id="tPri" style="flex:0 0 80px"><option value="1">P1</option><option value="2" selected>P2</option><option value="3">P3</option></select>
      </div><div class="row" style="margin-top:8px">
        <label class="grow">Frist / påmindelse<input type="datetime-local" id="tDue" /></label>
        <button class="btn" id="tAdd" style="align-self:flex-end">Tilføj</button></div></div>
      <div class="card">${open.length ? open.map(item).join("") : `<div class="empty">Ingen åbne opgaver 🎉</div>`}</div>
      ${done.length ? `<h3>Udført</h3><div class="card">${done.map(item).join("")}</div>` : ""}
      <p class="muted">Påmindelser vises, mens appen er åben. Vil du have påmindelser når appen er lukket, så tryk 📅 og læg opgaven i telefonens kalender.</p>`;
    $("#tAdd").onclick = () => {
      const title = $("#tTitle").value.trim(); if (!title) return;
      state.tasks.unshift({ id: uid(), title, priority: +$("#tPri").value, due: $("#tDue").value ? new Date($("#tDue").value).toISOString() : null, done: false, createdAt: Date.now() });
      save("tasks"); draw();
      if (Notification?.permission === "default") Notification.requestPermission();
    };
    view().onclick = (e) => {
      const id = e.target.closest("[data-id]")?.dataset.id; const t = state.tasks.find((x) => x.id === id); if (!t) return;
      if (e.target.matches("input[type=checkbox]")) { t.done = e.target.checked; t.doneAt = Date.now(); save("tasks"); draw(); }
      if (e.target.closest("[data-del]")) { state.tasks = state.tasks.filter((x) => x.id !== id); save("tasks"); draw(); }
      if (e.target.closest("[data-ics]")) download(`${t.title.slice(0, 30)}.ics`, ics(t), "text/calendar");
    };
  };
  const item = (t) => `<div class="item" data-id="${t.id}"><input type="checkbox" ${t.done ? "checked" : ""} style="width:auto;margin-top:4px" />
    <div class="body"><div style="${t.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(t.title)}</div>
    <div class="sub"><span class="badge ${t.priority === 1 ? "bad" : t.priority === 2 ? "warn" : ""}">P${t.priority}</span>
    ${t.due ? `<span style="color:${!t.done && new Date(t.due) < new Date() ? "var(--bad)" : "inherit"}">${new Date(t.due).toLocaleString("da-DK", { dateStyle: "medium", timeStyle: "short" })}</span>` : ""}</div></div>
    ${t.due ? `<button class="x" data-ics title="Læg i kalender">📅</button>` : ""}<button class="x" data-del title="Slet">✕</button></div>`;
  draw();
}

function ics(t) {
  const d = new Date(t.due);
  const f = (x) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const e = new Date(d.getTime() + 30 * 60000);
  const clean = (s) => s.replace(/[,;\\]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jarvis Lite//DA", "BEGIN:VEVENT", `UID:${t.id}@jarvis-lite`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(d)}`, `DTEND:${f(e)}`, `SUMMARY:${clean(t.title)}`, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${clean(t.title)}`, "TRIGGER:-PT15M",
    "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

// Påmindelser mens appen er åben
setInterval(() => {
  const now = Date.now();
  for (const t of state.tasks) {
    if (!t.done && t.due && !t.reminded && new Date(t.due).getTime() <= now) {
      t.reminded = true; save("tasks");
      toast("⏰ " + t.title, 8000);
      if (Notification?.permission === "granted") new Notification("Jarvis påmindelse", { body: t.title, icon: "icons/icon-192.png" });
    }
  }
}, 30000);

// ---------------- Viden (træning) ----------------
function renderKnow() {
  let filter = "";
  const draw = () => {
    const cats = [...new Set(state.knowledge.map((k) => k.category || "Andet"))];
    const list = state.knowledge.filter((k) => !filter || (k.category || "Andet") === filter);
    view().innerHTML = `<h2>Viden – træn din Jarvis</h2>
      <p class="muted">Alt her bruges af agenterne, når de svarer, og deres svar henviser til kilderne. Dine egne fakta og rettelser vægtes højest.
      Knappen ✏️ under et svar retter Jarvis, og rettelsen bruges næste gang.</p>
      <div class="card"><h3 style="margin-top:0">Lær Jarvis noget nyt</h3>
        <input id="kTitle" placeholder="Emne, fx 'Vores standard for terrasser'" />
        <textarea id="kText" rows="4" style="margin-top:8px" placeholder="Skriv viden, regler, priser, egne erfaringer, arbejdsgange…"></textarea>
        <div class="row" style="margin-top:8px"><input id="kCat" class="grow" placeholder="Kategori (fx Tilbud, Materialer, BR18)" list="cats" />
          <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
          <button class="btn" id="kAdd">Gem viden</button></div>
        <div class="row" style="margin-top:10px"><label class="btn sub" style="text-align:center">📄 Upload dokumenter (PDF, Word, TXT, MD, CSV)
          <input type="file" id="kFile" multiple accept=".pdf,.docx,.txt,.md,.csv,.json" hidden /></label></div>
      </div>
      <div class="segment"><button data-f="" class="${!filter ? "on" : ""}">Alle (${state.knowledge.length})</button>
        ${cats.map((c) => `<button data-f="${esc(c)}" class="${filter === c ? "on" : ""}">${esc(c)}</button>`).join("")}</div>
      <div class="card">${list.map((k) => `<div class="item" data-id="${k.id}"><div class="body">
        <div><span class="badge ${k.kind === "correction" ? "warn" : k.kind === "seed" ? "acc" : "ok"}">${{ seed: "Startviden", fact: "Egen viden", doc: "Dokument", correction: "Rettelse" }[k.kind] || k.kind}</span>
          <b>${esc(k.title)}</b>${k.disabled ? ` <span class="badge bad">slået fra</span>` : ""}</div>
        <div class="sub">${esc(k.text.slice(0, 220))}${k.text.length > 220 ? "…" : ""}</div>
        ${k.source ? `<div class="sub">Kilde: ${/^https?:/.test(k.source) ? `<a href="${esc(k.source)}" target="_blank" rel="noopener">${esc(k.source)}</a>` : esc(k.source)}</div>` : ""}</div>
        <button class="x" data-edit title="Redigér">✏️</button><button class="x" data-toggle title="Slå til/fra">${k.disabled ? "▶️" : "⏸"}</button><button class="x" data-del title="Slet">✕</button></div>`).join("") || `<div class="empty">Ingen viden i denne kategori.</div>`}</div>
      <div class="card"><h3 style="margin-top:0">Eksportér træningsdata</h3>
        <p class="muted">Dine rettelser og 👍-svar kan eksporteres som træningsdata (JSONL). Med dem kan du senere lave rigtig finjustering (LoRA) af en model på din egen server, så den lærer dine svar direkte.</p>
        <button class="btn sub" id="kExport">⬇️ Træningsdata (${state.feedback.length} eksempler)</button>
        <button class="btn sub" id="kExportKb">⬇️ Vidensbase (JSON)</button></div>`;
    $("#kAdd").onclick = () => {
      const title = $("#kTitle").value.trim(), text = $("#kText").value.trim();
      if (!title || !text) return toast("Skriv emne og tekst");
      state.knowledge.unshift({ id: uid(), kind: "fact", title, text, category: $("#kCat").value.trim() || "Egen viden", source: "Dig", createdAt: Date.now() });
      save("knowledge"); toast("✅ Jarvis har lært det"); draw();
    };
    $("#kFile").onchange = async (e) => {
      for (const f of e.target.files) {
        try {
          const text = await fileToText(f);
          if (!text.trim()) throw new Error("ingen tekst fundet");
          state.knowledge.unshift({ id: uid(), kind: "doc", title: f.name, text, category: "Dokumenter", source: f.name, createdAt: Date.now() });
          toast(`📄 ${f.name}: ${Math.round(text.length / 1000)}k tegn lært`);
        } catch (err) { toast(`⚠️ ${f.name}: ${err.message}`, 6000); }
      }
      save("knowledge"); draw();
    };
    $("#kExport").onclick = () => download("jarvis-traening.jsonl", trainingJsonl(), "application/jsonl");
    $("#kExportKb").onclick = () => download("jarvis-vidensbase.json", JSON.stringify(state.knowledge, null, 2), "application/json");
    view().onclick = (e) => {
      const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; draw(); return; }
      const id = e.target.closest("[data-id]")?.dataset.id; const k = state.knowledge.find((x) => x.id === id); if (!k) return;
      if (e.target.closest("[data-del]") && confirm("Slet denne viden?")) { state.knowledge = state.knowledge.filter((x) => x.id !== id); save("knowledge"); draw(); }
      if (e.target.closest("[data-toggle]")) { k.disabled = !k.disabled; save("knowledge"); draw(); }
      if (e.target.closest("[data-edit]")) { const t = prompt("Redigér teksten:", k.text); if (t !== null) { k.text = t; if (k.kind === "seed") k.kind = "fact"; save("knowledge"); draw(); } }
    };
  };
  draw();
}

function trainingJsonl() {
  const sys = AGENTS.konstruktor.system;
  return state.feedback.filter((f) => f.q && (f.correction || f.rating === 1))
    .map((f) => JSON.stringify({ messages: [{ role: "system", content: (AGENTS[f.agent] || AGENTS.konstruktor).system || sys },
      { role: "user", content: f.q }, { role: "assistant", content: f.correction || f.a }] })).join("\n");
}

async function fileToText(f) {
  const ext = f.name.split(".").pop().toLowerCase();
  if (ext === "pdf") {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
    let out = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out += `\n[Side ${p}]\n` + tc.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("");
      progress(p / doc.numPages, `Læser ${f.name} – side ${p}/${doc.numPages}`);
    }
    progress(null);
    return out;
  }
  if (ext === "docx") {
    const { default: mammoth } = await import("https://esm.sh/mammoth@1.8.0");
    return (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
  }
  return await f.text();
}

// ---------------- Mere: model, hukommelse, indstillinger, backup ----------------
async function renderMore() {
  const prof = state.settings.profile || {};
  view().innerHTML = `<h2>Indstillinger</h2>
    <div class="card"><h3 style="margin-top:0">Om mig – så Jarvis kender dig</h3>
      <div class="grid2">
        <label>Navn<input id="pNavn" value="${esc(prof.navn || "")}" placeholder="fx René" /></label>
        <label>Firma / fag<input id="pFirma" value="${esc(prof.firma || "")}" placeholder="fx Tømrermester, eget firma" /></label>
      </div>
      <label style="margin-top:8px">Sådan vil jeg have hjælp (tone, detaljer, hvad jeg laver)
        <textarea id="pOm" rows="3" placeholder="fx: Jeg er uddannet tømrer og laver tilbygninger og tage. Svar konkret og kort, med mål i mm. Husk BR18.">${esc(prof.om || "")}</textarea></label>
      <button class="btn" id="pSave" style="margin-top:8px">Gem profil</button>
      <p class="muted" style="font-size:12px">Bruges i alle samtaler. Ligger kun på din enhed.</p>
    </div>
    <div class="card"><h3 style="margin-top:0">Træn Jarvis med din viden</h3>
      <p class="muted" style="font-size:12.5px">Lær Jarvis dine regler, priser, fremgangsmåder og erfaringer. Det bruges aktivt, når den svarer – og vægtes højere end dens startviden.</p>
      <input id="tgTitle" placeholder="Emne, fx 'Min standardpris på tagarbejde'" />
      <textarea id="tgText" rows="3" style="margin-top:8px" placeholder="Skriv viden, regler, priser, arbejdsgange, erfaringer…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="tgSave">Gem viden</button>
        <button class="btn sub" id="tgOpen">📚 Åbn vidensbank & upload dokumenter</button></div>
      <div id="tgList" class="muted" style="margin-top:8px"></div>
    </div>
    <div class="card"><h3 style="margin-top:0">AI-model (kører på din enhed)</h3>
      <div id="gpuBadge"></div>
      <div id="models" class="muted">Henter modelkatalog…</div>
      <p class="muted">Første gang hentes modellen (0,5–5 GB) og gemmes i browseren – derefter kører alt offline. Større model = klogere, men langsommere og kræver mere hukommelse. Til kode: vælg en Coder-model i fanen Kode.</p></div>
    <div class="card"><h3 style="margin-top:0">Hukommelse</h3>
      <label class="row" style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="autoMem" style="width:auto" ${state.settings.autoMemory ? "checked" : ""}/> Lær automatisk om mig fra samtaler</label>
      <div class="row" style="margin-top:8px"><input id="memNew" class="grow" placeholder="Tilføj noget Jarvis skal huske om dig…" /><button class="btn" id="memAdd">Gem</button></div>
      <div id="mems"></div></div>
    <div class="card"><h3 style="margin-top:0">Stemme</h3>
      <label>Sprog<select id="lang"><option value="da">Dansk</option><option value="en">English</option></select></label>
      <label style="margin-top:8px">Oplæsningsstemme (enhedens egne)<select id="voiceSel"></select></label>
      <label style="margin-top:8px">Talegenkendelse (lokal Whisper)<select id="whisper">
        <option value="Xenova/whisper-tiny">Whisper tiny – hurtigst (≈ 40 MB)</option>
        <option value="Xenova/whisper-base">Whisper base – anbefalet (≈ 80 MB)</option>
        <option value="Xenova/whisper-small">Whisper small – bedst dansk (≈ 250 MB)</option></select></label></div>
    <div class="card"><h3 style="margin-top:0">Data & forbindelser</h3>
      <label>Virksomhedsregister (CVR) – søg på navn eller CVR-nummer
        <div class="row" style="margin-top:4px"><input id="cvrQ" class="grow" placeholder="fx 'Succes Cleaning' eller 12345678" /><button class="btn" id="cvrBtn">Slå op</button></div></label>
      <div id="cvrRes" class="muted" style="margin-top:8px"></div>
      <h3>Hvad kan den lokale app – og hvad kræver serveren?</h3>
      <p class="muted" style="font-size:13px">Denne app kører 100% i din browser. Det gør den privat og gratis, men sætter grænser. Det der kræver en server, bygger vi på Jarvis 1.0 (den fulde version i projektet).</p>
      <div style="font-size:13px">
        <div class="item"><span class="badge ok">virker her</span><div class="body">Chat, stemme, hukommelse, træning, dokumenter, CAD-tegninger, hjemmesider, research (Wikipedia + CVR), PDF, billed-upload (med vision-model).</div></div>
        <div class="item"><span class="badge warn">kræver server</span><div class="body">Hente fra BBR/byggeregisteret (Datafordeler kræver login/nøgle), køre opgaver 24/7, automatiseringer når appen er lukket, selv gå ind på andre sider og udfylde formularer, og familie-logins hvor I hver har jeres egen Jarvis og du ser alt.</div></div>
        <div class="item"><span class="badge bad">ikke muligt uden åbent API</span><div class="body">Styre ure, briller, TV og andre enheder kræver, at enheden har et åbent API – mange (fx smart-briller) har det ikke. Billedgenerering lokalt kræver meget kraftig hardware; realistisk sker det bedst via en server.</div></div>
      </div>
      <p class="muted" style="font-size:12.5px">Hacking/indtrængen i systemer bygger jeg ikke – heller ikke i serverversionen.</p></div>
    <div class="card"><h3 style="margin-top:0">Backup</h3>
      <p class="muted">Alt ligger kun på denne enhed. Tag backup jævnligt, og flyt data mellem telefon og computer med eksport/import.</p>
      <div class="row"><button class="btn sub" id="exp">⬇️ Eksportér alt</button><label class="btn sub" style="text-align:center">⬆️ Importér<input type="file" id="imp" accept=".json" hidden /></label>
      <button class="btn danger" id="wipe">Slet alle data</button></div></div>
    <div class="card"><h3 style="margin-top:0">Installér som app</h3>
      <p class="muted"><b>iPhone/iPad:</b> Safari → Del-knappen → “Føj til hjemmeskærm”.<br><b>Android:</b> Chrome → ⋮ → “Installer app”.<br><b>Computer:</b> Chrome/Edge → installér-ikonet i adresselinjen.</p>
      <p class="muted">Privatliv: Ingen data sendes nogen steder hen. Kun programfiler og AI-modeller hentes ved første brug (fra GitHub Pages, jsDelivr og Hugging Face).</p></div>`;

  // Modeller – hentes uafhængigt (fire-and-forget), så de øvrige knapper ALTID virker med det samme,
  // også hvis modelkataloget er langsomt eller utilgængeligt.
  (async () => {
    try {
      const gpu = await webgpuInfo();
      const badge = $("#gpuBadge"); if (badge) badge.innerHTML = gpu.ok ? `<span class="badge ok">WebGPU OK</span>` : `<div class="warnbox">${esc(gpu.reason)}</div>`;
      const cat = await modelCatalog();
      const rec = recommendedModel(cat);
      if (!$("#models")) return;
      $("#models").innerHTML = cat.filter((m) => m.kind === "chat").map((m) => `<div class="item"><div class="body"><b>${esc(m.id.replace(/-q4f(16|32)_1-MLC$/, ""))}</b>
        ${m.id === rec ? `<span class="badge acc">anbefalet</span>` : ""}${m.id === llm.model ? `<span class="badge ok">indlæst</span>` : ""}
        <div class="sub">kræver ca. ${(m.vram / 1000).toFixed(1)} GB grafikhukommelse</div></div>
        <button class="btn sm ${m.id === llm.model ? "sub" : ""}" data-load="${m.id}" ${m.id === llm.model ? "disabled" : ""}>${m.id === llm.model ? "Aktiv" : "Brug"}</button></div>`).join("");
      $("#models").onclick = async (e) => {
        const b = e.target.closest("[data-load]"); if (!b) return;
        b.disabled = true; b.textContent = "Henter…";
        try { await loadModel(b.dataset.load); state.settings.model = b.dataset.load; save("settings"); toast("Model klar ✓"); renderMore(); }
        catch (err) { toast("⚠️ " + err.message, 7000); b.disabled = false; b.textContent = "Brug"; }
      };
    } catch (e) { if ($("#models")) $("#models").textContent = "Kunne ikke hente modelkatalog (kræver internet første gang): " + e.message; }
  })();

  // Hukommelse
  const drawMems = () => {
    $("#mems").innerHTML = state.memories.length ? state.memories.map((m) => `<div class="item" data-id="${m.id}"><div class="body">${esc(m.content)}
      <div class="sub">${m.auto ? "lært automatisk" : "tilføjet af dig"} · ${new Date(m.createdAt).toLocaleDateString("da-DK")}</div></div>
      <button class="x" data-pin title="Fastgør">${m.pinned ? "📌" : "📍"}</button><button class="x" data-edit>✏️</button><button class="x" data-del>✕</button></div>`).join("")
      : `<div class="empty">Jarvis husker ikke noget om dig endnu.</div>`;
  };
  drawMems();
  $("#mems").onclick = (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id; const m = state.memories.find((x) => x.id === id); if (!m) return;
    if (e.target.closest("[data-del]")) state.memories = state.memories.filter((x) => x.id !== id);
    if (e.target.closest("[data-pin]")) m.pinned = !m.pinned;
    if (e.target.closest("[data-edit]")) { const t = prompt("Redigér:", m.content); if (t) m.content = t; }
    save("memories"); drawMems();
  };
  $("#memAdd").onclick = () => { const c = $("#memNew").value.trim(); if (!c) return; state.memories.unshift({ id: uid(), content: c, importance: 0.8, createdAt: Date.now() }); save("memories"); $("#memNew").value = ""; drawMems(); };
  $("#autoMem").onchange = (e) => { state.settings.autoMemory = e.target.checked; save("settings"); };
  $("#pSave").onclick = () => { state.settings.profile = { navn: $("#pNavn").value.trim(), firma: $("#pFirma").value.trim(), om: $("#pOm").value.trim() }; save("settings"); toast("Profil gemt ✓ – Jarvis kender dig nu"); };
  const drawTg = () => { const own = state.knowledge.filter((k) => k.kind !== "seed"); $("#tgList").innerHTML = own.length ? `Du har lært Jarvis ${own.length} ting. Nyeste: ${esc((own[0].title || "").slice(0, 60))}` : "Du har ikke lært Jarvis noget endnu."; };
  drawTg();
  $("#tgSave").onclick = () => { const t = $("#tgTitle").value.trim(), x = $("#tgText").value.trim(); if (!t || !x) return toast("Skriv både emne og tekst"); state.knowledge.unshift({ id: uid(), kind: "fact", title: t, text: x, category: "Egen viden", source: "Dig", createdAt: Date.now() }); save("knowledge"); $("#tgTitle").value = ""; $("#tgText").value = ""; toast("✅ Jarvis har lært det"); drawTg(); };
  $("#tgOpen").onclick = () => go("know");

  // Stemme
  $("#lang").value = state.settings.lang; $("#whisper").value = state.settings.whisper;
  $("#lang").onchange = (e) => { state.settings.lang = e.target.value; save("settings"); fillVoices(); };
  $("#whisper").onchange = (e) => { state.settings.whisper = e.target.value; save("settings"); };
  const fillVoices = () => {
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(state.settings.lang));
    $("#voiceSel").innerHTML = `<option value="">Standard</option>` + vs.map((v) => `<option ${v.name === state.settings.voiceName ? "selected" : ""}>${esc(v.name)}</option>`).join("");
  };
  fillVoices(); speechSynthesis.onvoiceschanged = fillVoices;
  $("#voiceSel").onchange = (e) => { state.settings.voiceName = e.target.value; save("settings"); speakText(state.settings.lang === "da" ? "Hej, jeg er Jarvis." : "Hello, I am Jarvis."); };

  // Backup
  $("#exp").onclick = async () => download(`jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll()), "application/json");
  $("#imp").onchange = async (e) => {
    try { await importAll(JSON.parse(await e.target.files[0].text())); toast("Backup gendannet ✓"); renderMore(); } catch (err) { toast("⚠️ " + err.message); }
  };
  $("#cvrBtn").onclick = async () => {
    const q = $("#cvrQ").value.trim(); if (!q) return;
    $("#cvrRes").textContent = "Slår op…";
    try {
      const c = await cvr(q);
      $("#cvrRes").innerHTML = `<div class="result"><b>${esc(c.navn || "")}</b> · CVR ${esc(String(c.cvr || ""))} ${c.status ? `<span class="badge ok">${esc(c.status)}</span>` : ""}<br>
        ${esc(c.adresse || "")}<br>${esc(c.branche || "")}${c.form ? " · " + esc(c.form) : ""}${c.ansatte ? " · " + esc(String(c.ansatte)) + " ansatte" : ""}
        ${c.telefon ? "<br>Tlf: " + esc(String(c.telefon)) : ""}${c.email ? " · " + esc(c.email) : ""}
        <br><a href="${esc(c.url)}" target="_blank" rel="noopener">Se på Virk</a>
        <button class="btn sm sub" id="cvrSave" style="margin-top:6px">Gem i hukommelsen</button></div>`;
      $("#cvrSave").onclick = () => { state.memories.unshift({ id: uid(), content: `Virksomhed: ${c.navn}, CVR ${c.cvr}, ${c.adresse}. ${c.branche || ""}`, importance: 0.7, createdAt: Date.now() }); save("memories"); toast("Gemt"); };
    } catch (e) { $("#cvrRes").innerHTML = `<span class="badge bad">${esc(e.message)}</span> – virker kun hvis tjenesten tillader browseropslag (CORS). Ellers via serverversionen.`; }
  };
  $("#wipe").onclick = async () => {
    if (prompt("Skriv SLET for at slette alle data på denne enhed") !== "SLET") return;
    indexedDB.deleteDatabase("jarvis-lite"); location.reload();
  };
}

// ---------------- Start ----------------
function showFatal(msg) {
  let bar = document.getElementById("fatalBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "fatalBar"; bar.className = "warnbox"; bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999;margin:0;border-radius:0;font-size:12.5px"; document.body.appendChild(bar); }
  bar.textContent = "⚠️ " + String(msg).slice(0, 200);
}
addEventListener("error", (e) => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) console.warn("fejl:", e.message); });

async function autoStartModel() {
  if (llm.engine || _loading) return;
  const gpu = await webgpuInfo();
  if (!gpu.ok) return; // hero viser kompatibilitetsbesked
  // Spar på mobildata: hent kun automatisk hvis data-saver er slået fra; ellers venter vi på ét tryk.
  if (navigator.connection?.saveData) { if (tab === "chat") renderChatAgain(); return; }
  await quickLoad();
}

(async function boot() {
  try { if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {}); } catch {}
  try { await loadAll(); } catch (e) { console.warn("loadAll:", e); }
  try { updateHeader(); } catch (e) { console.warn(e); }
  try { go("chat"); } catch (e) { showFatal("Kunne ikke starte: " + e.message); return; }
  autoStartModel().catch((e) => console.warn("autostart:", e));
})();
