// Kodeværksted: projekter, filer, editor, live-forhåndsvisning og en lokal AI-programmør, der foreslår filændringer.
import { $, AGENTS, download, esc, generate, llm, loadModel, modelCatalog, recommendedModel, save, state, stopGenerating, toast, uid } from "./core.js";
import { md } from "./md.js";

let cur = { project: null, file: null, dir: null, proposals: [] };

const TEMPLATE = () => ({
  "index.html": `<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mit Tømrerfirma</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="hero">
    <h1>Mit Tømrerfirma</h1>
    <p>Tilbygninger, tag, vinduer og renovering – udført efter BR18.</p>
    <a class="cta" href="#kontakt">Få et uforpligtende tilbud</a>
  </header>
  <section id="ydelser">
    <h2>Ydelser</h2>
    <ul><li>Tilbygninger</li><li>Tagrenovering</li><li>Vinduer og døre</li><li>Terrasser</li></ul>
  </section>
  <section id="kontakt">
    <h2>Kontakt</h2>
    <p>Ring på <a href="tel:+4500000000">00 00 00 00</a></p>
  </section>
  <script src="script.js"></script>
</body>
</html>
`,
  "style.css": `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1d232c; line-height: 1.6; }
.hero { background: #2f3b2a; color: #fff; padding: 64px 24px; text-align: center; }
.hero h1 { font-size: clamp(2rem, 6vw, 3.4rem); margin: 0 0 8px; }
.cta { display: inline-block; margin-top: 16px; background: #e0a64b; color: #1d232c; padding: 12px 22px; border-radius: 10px; text-decoration: none; font-weight: 600; }
section { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
`,
  "script.js": `// Dit JavaScript her\nconsole.log("Hjemmesiden er klar");\n`,
});

function project() {
  if (!state.projects.length) {
    state.projects.push({ id: uid(), name: "Tømrerfirma-hjemmeside", files: TEMPLATE(), versions: [], chat: [], createdAt: Date.now() });
    save("projects");
  }
  cur.project = state.projects.find((p) => p.id === cur.project?.id) || state.projects.find((p) => p.id === state.settings.currentProject) || state.projects[0];
  if (!cur.file || !(cur.file in cur.project.files)) cur.file = Object.keys(cur.project.files)[0] || null;
  return cur.project;
}

/** Samler en side til forhåndsvisning: lokale css/js-filer indlejres. Kører i en sandboxet iframe uden adgang til appen. */
export function buildPreview(files, entry = "index.html") {
  let html = files[entry] ?? Object.entries(files).find(([k]) => k.endsWith(".html"))?.[1] ?? "<p>Ingen HTML-fil</p>";
  html = html.replace(/<link[^>]+href=["']([^"':]+\.css)["'][^>]*>/g, (m, href) => (files[href.replace(/^\.\//, "")] != null ? `<style>\n${files[href.replace(/^\.\//, "")]}\n</style>` : m));
  html = html.replace(/<script([^>]*)src=["']([^"':]+\.js)["']([^>]*)><\/script>/g, (m, a, src, b) => {
    const c = files[src.replace(/^\.\//, "")];
    return c != null ? `<script${a}${b}>\n${c.replace(/<\/script/gi, "<\\/script")}\n</script>` : m;
  });
  return html;
}

/** Finder filforslag i AI'ens svar: ### FILE: sti + kodeblok */
export function parseFileBlocks(text) {
  const out = [];
  const rx = /(?:^|\n)#{0,4}\s*(?:FILE|FIL|Fil|File):\s*`?([\w./\-]+)`?\s*\n```[\w+-]*\n([\s\S]*?)\n```/g;
  for (const m of text.matchAll(rx)) out.push({ path: m[1].replace(/^\.?\//, ""), content: m[2] + "\n" });
  return out;
}

export function renderCode() {
  const p = project();
  const files = Object.keys(p.files).sort();
  $("#view").innerHTML = `<h2>Kodeværksted</h2>
    <div class="toolbar">
      <select id="pSel">${state.projects.map((x) => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <button class="btn sub sm" id="pNew">＋ Projekt</button>
      <button class="btn sub sm" id="pOpen">📂 Åbn mappe</button>
      ${cur.dir ? `<button class="btn sub sm" id="pSaveDir">💾 Gem i mappe</button>` : ""}
      <button class="btn sub sm" id="pZip">⬇️ ZIP</button>
      <button class="btn ghost sm" id="pDel">Slet</button>
    </div>
    <div class="code-layout">
      <div class="card files" style="padding:8px">
        ${files.map((f) => `<button data-file="${esc(f)}" class="${f === cur.file ? "on" : ""}">${esc(f)}</button>`).join("")}
        <button id="fNew" style="color:var(--accent)">＋ ny fil</button>
      </div>
      <div>
        <div class="row" style="margin-bottom:6px"><b class="grow" style="font-family:ui-monospace,monospace;font-size:13px">${esc(cur.file || "")}</b>
          ${cur.file ? `<button class="btn ghost sm" id="fUndo">↶ Fortryd</button><button class="btn ghost sm" id="fDel">Slet fil</button>` : ""}
          <button class="btn sm" id="prevBtn">▶ Vis side</button></div>
        <textarea class="editor" id="editor" spellcheck="false">${esc(cur.file ? p.files[cur.file] : "")}</textarea>
        <iframe class="preview hidden" id="preview" sandbox="allow-scripts allow-forms allow-modals" title="Forhåndsvisning"></iframe>
      </div>
    </div>
    <div class="card">
      <div class="row"><b class="grow">⌨️ AI-programmør</b><span class="muted" id="cModel">${esc(llm.model ? llm.model.replace(/-q4f(16|32)_1-MLC$/, "") : "ingen model")}</span>
        <button class="btn sub sm" id="coder">Brug kodemodel</button></div>
      <div id="cChat" class="chat" style="padding-bottom:0;margin-top:10px"></div>
      <div id="proposals"></div>
      <div class="row" style="margin-top:8px"><textarea id="cIn" rows="2" class="grow" placeholder="Fx: Lav en flot forside med billedgalleri og kontaktformular"></textarea>
        <button class="btn" id="cSend">${llm.busy ? "■" : "Send"}</button></div>
      <p class="muted" style="font-size:12px">Den lokale model ser projektets filer og foreslår hele filer, som du godkender én for én. Små modeller laver fejl – brug ▶ Vis side og ↶ Fortryd.</p>
    </div>`;

  const editor = $("#editor");
  editor.addEventListener("input", () => { if (cur.file) { p.files[cur.file] = editor.value; save("projects"); } });
  editor.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); const s = editor.selectionStart; editor.setRangeText("  ", s, editor.selectionEnd, "end"); editor.dispatchEvent(new Event("input")); } });
  $(".files").onclick = (e) => {
    const b = e.target.closest("[data-file]"); if (b) { cur.file = b.dataset.file; renderCode(); }
    if (e.target.id === "fNew") { const n = prompt("Filnavn (fx about.html eller js/app.js):"); if (n?.trim()) { p.files[n.trim()] = ""; cur.file = n.trim(); save("projects"); renderCode(); } }
  };
  $("#fDel")?.addEventListener("click", () => { if (confirm(`Slet ${cur.file}?`)) { snapshot(p, cur.file); delete p.files[cur.file]; cur.file = null; save("projects"); renderCode(); } });
  $("#fUndo")?.addEventListener("click", () => {
    const i = p.versions.map((v) => v.path).lastIndexOf(cur.file);
    if (i < 0) return toast("Ingen tidligere version");
    p.files[cur.file] = p.versions[i].content; p.versions.splice(i, 1); save("projects"); renderCode(); toast("Gendannet forrige version");
  });
  $("#prevBtn").onclick = () => {
    const f = $("#preview"); const show = f.classList.contains("hidden");
    f.classList.toggle("hidden", !show); editor.classList.toggle("hidden", show);
    $("#prevBtn").textContent = show ? "✎ Redigér" : "▶ Vis side";
    if (show) f.srcdoc = buildPreview(p.files, cur.file?.endsWith(".html") ? cur.file : "index.html");
  };
  $("#pSel").onchange = (e) => { cur.project = state.projects.find((x) => x.id === e.target.value); state.settings.currentProject = cur.project.id; cur.file = null; cur.dir = null; save("settings"); renderCode(); };
  $("#pNew").onclick = () => {
    const name = prompt("Projektnavn:", "Ny hjemmeside"); if (!name) return;
    const np = { id: uid(), name, files: confirm("Start fra skabelon (tømrerfirma-hjemmeside)?") ? TEMPLATE() : { "index.html": "" }, versions: [], chat: [], createdAt: Date.now() };
    state.projects.unshift(np); cur.project = np; cur.file = null; state.settings.currentProject = np.id; save("projects"); save("settings"); renderCode();
  };
  $("#pDel").onclick = () => { if (confirm(`Slet projektet "${p.name}" fra appen? (filer i en åbnet mappe røres ikke)`)) { state.projects = state.projects.filter((x) => x.id !== p.id); cur.project = null; save("projects"); renderCode(); } };
  $("#pZip").onclick = zip;
  $("#pOpen").onclick = openFolder;
  $("#pSaveDir")?.addEventListener("click", saveToFolder);
  $("#coder").onclick = async () => {
    try {
      const cat = await modelCatalog();
      const id = state.settings.codeModel || recommendedModel(cat, "code");
      if (!id) return toast("Ingen kodemodel i kataloget");
      if (!confirm(`Skift til ${id}? Den hentes første gang og gemmes på enheden.`)) return;
      await loadModel(id); state.settings.codeModel = id; save("settings"); renderCode();
    } catch (e) { toast("⚠️ " + e.message, 6000); }
  };

  // AI-chat
  const drawChat = () => {
    $("#cChat").innerHTML = p.chat.slice(-8).map((m) => `<div class="msg ${m.role === "user" ? "user" : "bot"}">${m.role === "user" ? esc(m.content) : md(m.content)}</div>`).join("");
    drawProposals();
  };
  const drawProposals = () => {
    $("#proposals").innerHTML = cur.proposals.length ? `<div class="action"><b>Foreslåede filændringer</b>
      ${cur.proposals.map((f, i) => `<div class="row" style="margin-top:6px"><span class="grow" style="font-family:ui-monospace,monospace">${esc(f.path)} ${p.files[f.path] == null ? `<span class="badge ok">ny</span>` : `<span class="badge warn">ændret</span>`}
        <span class="muted">${f.content.split("\n").length} linjer</span></span>${f.applied ? `<span class="badge ok">anvendt</span>` : `<button class="btn sm" data-ap="${i}">Anvend</button>`}</div>`).join("")}
      <div class="row" style="margin-top:8px"><button class="btn sm" id="apAll">Anvend alle</button><button class="btn ghost sm" id="apNone">Afvis</button></div></div>` : "";
  };
  $("#proposals").onclick = (e) => {
    const b = e.target.closest("[data-ap]");
    const apply = (f) => { if (f.applied) return; snapshot(p, f.path); p.files[f.path] = f.content; f.applied = true; };
    if (b) apply(cur.proposals[+b.dataset.ap]);
    if (e.target.id === "apAll") cur.proposals.forEach(apply);
    if (e.target.id === "apNone") cur.proposals = [];
    if (b || e.target.id === "apAll") { save("projects"); toast("Ændringer anvendt – tryk ▶ Vis side"); renderCode(); return; }
    drawProposals();
  };
  drawChat();

  $("#cSend").onclick = async () => {
    if (llm.busy) return stopGenerating();
    const text = $("#cIn").value.trim(); if (!text) return;
    if (!llm.engine) return toast("Indlæs en model først (knappen 'Brug kodemodel')");
    const ctxFiles = Object.entries(p.files).map(([k, v]) => `### FILE: ${k}\n\`\`\`\n${v.slice(0, k === cur.file ? 9000 : 3500)}\n\`\`\``).join("\n\n").slice(0, 16000);
    const messages = [{ role: "system", content: AGENTS.developer.system + `\n\nProjekt: ${p.name}. Filer i projektet:\n${ctxFiles}` },
      ...p.chat.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })), { role: "user", content: text }];
    p.chat.push({ role: "user", content: text }); $("#cIn").value = "";
    const bot = { role: "assistant", content: "" }; p.chat.push(bot);
    drawChat(); $("#cSend").textContent = "■";
    const node = $("#cChat").lastElementChild;
    try {
      bot.content = await generate(messages, { temperature: 0.2, max_tokens: 4000, onToken: (t) => { node.innerHTML = md(t); } });
    } catch (e) { bot.content += "\n\n⚠️ " + e.message; }
    cur.proposals = parseFileBlocks(bot.content);
    save("projects");
    $("#cSend").textContent = "Send";
    drawChat();
    if (!cur.proposals.length && /```/.test(bot.content)) toast("Tip: bed den skrive '### FILE: navn' før koden, så kan den anvendes direkte");
  };
}

function snapshot(p, path) {
  if (p.files[path] == null) return;
  p.versions.push({ path, content: p.files[path], ts: Date.now() });
  if (p.versions.length > 60) p.versions.shift();
}

async function zip() {
  const p = cur.project;
  try {
    const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
    const z = new JSZip();
    for (const [k, v] of Object.entries(p.files)) z.file(k, v);
    download(`${p.name.replace(/[^\wæøåÆØÅ-]+/g, "_")}.zip`, await z.generateAsync({ type: "blob" }));
  } catch (e) { toast("⚠️ ZIP kræver internet første gang: " + e.message); }
}

const TEXT_EXT = /\.(html?|css|js|mjs|ts|tsx|jsx|json|md|txt|svg|py|php|xml|yml|yaml|toml|env\.example|gitignore)$/i;
const SKIP_DIR = /^(node_modules|\.git|\.next|dist|build|\.venv|__pycache__)$/;

async function openFolder() {
  if (!window.showDirectoryPicker) {
    // Fallback (Safari/iOS/Firefox): vælg filer fra en mappe – kun læsning
    const inp = Object.assign(document.createElement("input"), { type: "file", multiple: true, webkitdirectory: true });
    inp.onchange = async () => {
      const files = {};
      for (const f of inp.files) { const rel = f.webkitRelativePath.split("/").slice(1).join("/"); if (TEXT_EXT.test(rel) && f.size < 400000 && !rel.split("/").some((s) => SKIP_DIR.test(s))) files[rel] = await f.text(); }
      addImported(inp.files[0]?.webkitRelativePath.split("/")[0] || "Importeret", files, null);
    };
    inp.click();
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    const files = {};
    const walk = async (h, prefix) => {
      for await (const [name, e] of h.entries()) {
        if (e.kind === "directory") { if (!SKIP_DIR.test(name)) await walk(e, prefix + name + "/"); }
        else if (TEXT_EXT.test(name)) { const f = await e.getFile(); if (f.size < 400000) files[prefix + name] = await f.text(); }
        if (Object.keys(files).length > 300) return;
      }
    };
    await walk(dir, "");
    addImported(dir.name, files, dir);
  } catch (e) { if (e.name !== "AbortError") toast("⚠️ " + e.message); }
}

function addImported(name, files, dir) {
  if (!Object.keys(files).length) return toast("Ingen tekst-/kodefiler fundet");
  const p = { id: uid(), name, files, versions: [], chat: [], createdAt: Date.now() };
  state.projects.unshift(p); cur.project = p; cur.file = null; cur.dir = dir; state.settings.currentProject = p.id;
  save("projects"); save("settings"); toast(`📂 ${Object.keys(files).length} filer indlæst`); renderCode();
}

async function saveToFolder() {
  const p = cur.project;
  if (!cur.dir || !confirm(`Skriv ${Object.keys(p.files).length} filer til mappen "${cur.dir.name}"? Eksisterende filer med samme navn overskrives.`)) return;
  try {
    for (const [path, content] of Object.entries(p.files)) {
      const parts = path.split("/"); let h = cur.dir;
      for (const d of parts.slice(0, -1)) h = await h.getDirectoryHandle(d, { create: true });
      const w = await (await h.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(content); await w.close();
    }
    toast("💾 Gemt i mappen");
  } catch (e) { toast("⚠️ " + e.message); }
}
