// Tegne-fane: AI-beskrivelse → bygningsmodel → 2D-plan + 3D-visning + eksport (DXF/IFC/OBJ) + BR18-tjek.
import { $, download, esc, generate, llm, save, state, toast, uid } from "./core.js";
import { bounds, demoHouse, mesh3d, plan2d, toDXF, toDXF3D, toIFC, toOBJ, validateModel, wallGeom } from "./cad.js";

const THREE_URL = "https://esm.sh/three@0.160.0";
let model = null, view3d = null;

function getModel() {
  if (model) return model;
  model = state.settings.cadModel || demoHouse();
  return model;
}
function setModel(m) { model = m; state.settings.cadModel = m; save("settings"); }

const SCHEMA = `Du laver bygningsmodeller til CAD. Svar KUN med JSON i dette skema (mål i millimeter, akseparallelle vægge):
{"wallHeight":2600,"walls":[{"x1":0,"y1":0,"x2":10000,"y2":0,"thickness":300,"type":"ext","openings":[{"pos":5000,"width":1000,"height":2100,"sill":0,"type":"door"}]}],"roof":{"type":"gable","pitch":35,"overhang":500},"slab":true,"labels":[{"x":2000,"y":2500,"text":"Stue"}]}
Regler: ydervægge type "ext" (tykkelse 300), indervægge "int" (108). Åbninger: "pos" = afstand i mm fra vægstart til midten, "sill" = brystningshøjde (0 for døre, 900 for vinduer). Luk ydervæggene i en sammenhængende ring. Placer labels midt i rummene. Brug kun tal uden enheder.`;

export function renderDrawing(host) {
  host.innerHTML = `<div class="card">
    <h3 style="margin-top:0">Tegn med ord</h3>
    <textarea id="cadPrompt" rows="2" placeholder="Fx: Enfamiliehus 10×8 m, 2,6 m til loft, hoveddør og to vinduer mod syd, gavltag 35°, stue, køkken, bad og et værelse"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn" id="cadGen">Lav tegning</button>
      <button class="btn sub" id="cadDemo">Indsæt demohus</button>
      <button class="btn ghost" id="cadEdit">Redigér mål</button></div>
    <div id="cadMsg" class="muted" style="margin-top:6px"></div>
  </div>
  <div id="cadEditor"></div>
  <div class="card"><div class="row"><b class="grow">2D plantegning</b>
    <button class="btn sub sm" id="print2d">🖨 Print A3</button></div>
    <canvas id="plan" style="width:100%;background:#fff;border-radius:10px;border:1px solid var(--line)"></canvas></div>
  <div class="card"><div class="row"><b class="grow">3D-model</b><span class="muted">træk for at dreje</span></div>
    <div id="view3d" style="width:100%;height:360px;border-radius:10px;overflow:hidden;background:#0f1218"></div></div>
  <div id="cadCheck"></div>
  <div class="card"><h3 style="margin-top:0">Eksportér til CAD</h3>
    <div class="grid2">
      <button class="btn sub" data-exp="dxf2">⬇ Plan (DXF 2D)</button>
      <button class="btn sub" data-exp="dxf3">⬇ 3D (DXF)</button>
      <button class="btn sub" data-exp="ifc">⬇ IFC4 (Revit/BricsCAD BIM)</button>
      <button class="btn sub" data-exp="obj">⬇ OBJ (3D generelt)</button>
    </div>
    <p class="muted" style="font-size:12px">DXF og IFC importeres i AutoCAD, Revit, BricsCAD og ArchiCAD. Modellen er et præcist udgangspunkt – kontrollér mål, bærende konstruktioner og BR18-krav før projektering.</p></div>`;

  $("#cadDemo").onclick = () => { setModel(demoHouse()); refresh(); toast("Demohus indsat"); };
  $("#cadEdit").onclick = toggleEditor;
  $("#cadGen").onclick = aiGenerate;
  $("#print2d").onclick = () => printPlan(getModel());
  $("#cadCheck") && host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-exp]"); if (!b) return;
    const m = getModel();
    const name = "jarvis-tegning";
    try {
      if (b.dataset.exp === "dxf2") download(name + ".dxf", toDXF(m), "image/vnd.dxf");
      if (b.dataset.exp === "dxf3") download(name + "-3d.dxf", toDXF3D(m), "image/vnd.dxf");
      if (b.dataset.exp === "ifc") download(name + ".ifc", toIFC(m, { name: "Jarvis-projekt" }), "application/x-step");
      if (b.dataset.exp === "obj") download(name + ".obj", toOBJ(m), "text/plain");
      toast("Fil hentet ✓");
    } catch (err) { toast("⚠️ " + err.message); }
  });
  refresh();
}

function refresh() {
  const m = getModel();
  const v = validateModel(m);
  drawPlan(m);
  draw3d(m);
  const b = bounds(m);
  const area = Math.round((b.w / 1000) * (b.d / 1000));
  $("#cadCheck").innerHTML = `<div class="card"><h3 style="margin-top:0">Tjek</h3>
    <div>Ydermål ca. <b>${(b.w / 1000).toFixed(2)} × ${(b.d / 1000).toFixed(2)} m</b> · bruttoareal ca. ${area} m² · ${m.walls.length} vægge · ${m.walls.reduce((s, w) => s + (w.openings?.length || 0), 0)} åbninger</div>
    ${v.errors.map((e) => `<div class="badge bad" style="display:block;margin-top:6px;white-space:normal">✕ ${esc(e)}</div>`).join("")}
    ${v.warnings.map((w) => `<div class="badge warn" style="display:block;margin-top:6px;white-space:normal">⚠ ${esc(w)}</div>`).join("")}
    ${v.ok && !v.warnings.length ? `<div class="badge ok" style="margin-top:6px">Geometrien er gyldig</div>` : ""}
    <p class="muted" style="font-size:12px;margin-top:8px">Tip: brug beregnerne (U-værdi, dagslys, ventilation) til at eftervise BR18-kravene for tegningen.</p></div>`;
}

// ---------------- AI → model ----------------
async function aiGenerate() {
  const prompt = $("#cadPrompt").value.trim();
  if (!prompt) return;
  if (!llm.engine) return toast("Indlæs en AI-model først (knappen øverst)");
  $("#cadMsg").textContent = "Tegner…";
  try {
    const raw = await generate([{ role: "system", content: SCHEMA }, { role: "user", content: prompt }], { temperature: 0.2, max_tokens: 2500, json: true });
    const m = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (!m.walls?.length) throw new Error("Modellen manglede vægge – prøv at beskrive rummene tydeligere");
    m.wallHeight ||= 2600; m.slab ??= true;
    const v = validateModel(m);
    setModel(m); refresh();
    $("#cadMsg").textContent = v.ok ? "✓ Tegning klar. Tjek mål og ret efter behov." : "Tegning lavet, men tjek fejlene nedenfor.";
  } catch (e) {
    $("#cadMsg").textContent = "⚠️ " + e.message + " (små modeller kan have svært ved komplekse huse – prøv en simplere beskrivelse eller demohuset)";
  }
}

// ---------------- Redigér mål ----------------
function toggleEditor() {
  const host = $("#cadEditor");
  if (host.innerHTML) { host.innerHTML = ""; return; }
  const m = getModel();
  const b = bounds(m);
  host.innerHTML = `<div class="card"><h3 style="margin-top:0">Redigér mål</h3>
    <div class="grid2">
      <label>Bredde (m)<input id="eW" type="number" step="0.1" value="${(b.w / 1000).toFixed(2)}"></label>
      <label>Dybde (m)<input id="eD" type="number" step="0.1" value="${(b.d / 1000).toFixed(2)}"></label>
      <label>Væghøjde (m)<input id="eH" type="number" step="0.1" value="${(m.wallHeight / 1000).toFixed(2)}"></label>
      <label>Tag<select id="eRoof"><option value="gable"${m.roof?.type === "gable" ? " selected" : ""}>Gavltag</option><option value="hip"${m.roof?.type === "hip" ? " selected" : ""}>Valm</option><option value="flat"${m.roof?.type === "flat" ? " selected" : ""}>Fladt</option></select></label>
      <label>Taghældning (°)<input id="ePitch" type="number" value="${m.roof?.pitch ?? 35}"></label>
    </div>
    <button class="btn" id="eApply" style="margin-top:8px">Anvend</button>
    <details style="margin-top:10px"><summary class="muted">Avanceret: redigér rå model (JSON)</summary>
      <textarea id="eJson" rows="8" style="font-family:ui-monospace,monospace;font-size:12px;margin-top:6px">${esc(JSON.stringify(m, null, 1))}</textarea>
      <button class="btn sub sm" id="eJsonApply" style="margin-top:6px">Anvend JSON</button></details></div>`;
  $("#eApply").onclick = () => {
    const nm = scaleModel(getModel(), +$("#eW").value * 1000, +$("#eD").value * 1000, +$("#eH").value * 1000);
    nm.roof = { ...(nm.roof || {}), type: $("#eRoof").value, pitch: +$("#ePitch").value };
    setModel(nm); host.innerHTML = ""; refresh(); toast("Mål opdateret");
  };
  $("#eJsonApply").onclick = () => {
    try { const nm = JSON.parse($("#eJson").value); if (!nm.walls) throw new Error("mangler walls"); setModel(nm); host.innerHTML = ""; refresh(); toast("Model opdateret"); }
    catch (e) { toast("⚠️ Ugyldig JSON: " + e.message); }
  };
}

function scaleModel(m, newW, newD, newH) {
  const b = bounds(m);
  const sx = b.w ? newW / b.w : 1, sy = b.d ? newD / b.d : 1;
  const nm = JSON.parse(JSON.stringify(m));
  nm.wallHeight = newH;
  for (const w of nm.walls) {
    const g = wallGeom(w);
    const axisScale = Math.abs(g.ux) > 0.5 ? sx : sy;
    w.x1 = b.minX + (w.x1 - b.minX) * sx; w.x2 = b.minX + (w.x2 - b.minX) * sx;
    w.y1 = b.minY + (w.y1 - b.minY) * sy; w.y2 = b.minY + (w.y2 - b.minY) * sy;
    for (const o of w.openings || []) { o.pos *= axisScale; o.width *= axisScale; }
  }
  for (const l of nm.labels || []) { l.x = b.minX + (l.x - b.minX) * sx; l.y = b.minY + (l.y - b.minY) * sy; }
  return nm;
}

// ---------------- 2D-canvas ----------------
function drawPlan(m, canvas = $("#plan")) {
  if (!canvas) return;
  const L = plan2d(m);
  const b = bounds(m);
  const pad = 1400;
  const minX = b.minX - pad * 2, maxX = b.maxX + pad * 2, minY = b.minY - pad * 2, maxY = b.maxY + pad * 2;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || 600, ch = cw * ((maxY - minY) / (maxX - minX));
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.height = ch + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const s = cw / (maxX - minX);
  const X = (x) => (x - minX) * s, Y = (y) => ch - (y - minY) * s; // y opad
  ctx.lineJoin = "round";
  const drawSegs = (arr, color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; for (const g of arr) { ctx.beginPath(); ctx.moveTo(X(g[0][0]), Y(g[0][1])); for (let i = 1; i < g.length; i++) ctx.lineTo(X(g[i][0]), Y(g[i][1])); ctx.stroke(); } };
  drawSegs(L.walls, "#111", 2.4);
  drawSegs(L.windows, "#2f7fd0", 1.2);
  drawSegs(L.doors, "#c0392b", 1.2);
  drawSegs(L.openings, "#111", 1);
  ctx.strokeStyle = "#999"; ctx.fillStyle = "#555"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
  for (const d of L.dims) { ctx.beginPath(); ctx.moveTo(X(d.p0[0]), Y(d.p0[1])); ctx.lineTo(X(d.p1[0]), Y(d.p1[1])); ctx.stroke(); ctx.fillText(d.txt, X(d.mid[0]), Y(d.mid[1]) + (d.dir === "h" ? 14 : 0)); }
  ctx.fillStyle = "#222"; ctx.font = "13px system-ui";
  for (const t of L.text) ctx.fillText(t.text, X(t.x), Y(t.y));
}

function printPlan(m) {
  const w = window.open("", "_blank");
  if (!w) return toast("Tillad pop op for at printe");
  const c = w.document.createElement("canvas"); c.width = 1600; c.style.width = "100%";
  w.document.title = "Jarvis plantegning";
  w.document.body.style.margin = "0";
  w.document.body.appendChild(c);
  // genbrug tegnekoden ved midlertidigt at give canvas en bredde
  Object.defineProperty(c, "clientWidth", { value: 1600 });
  drawPlan(m, c);
  w.document.write(`<style>@page{size:A3 landscape;margin:12mm}img{width:100%}</style>`);
  const img = new Image(); img.src = c.toDataURL(); img.style.width = "100%";
  w.document.body.innerHTML = ""; w.document.body.appendChild(img);
  img.onload = () => w.print();
}

// ---------------- 3D (three.js) ----------------
async function draw3d(m) {
  const host = $("#view3d");
  if (!host) return;
  let THREE;
  try { THREE = await import(THREE_URL); } catch { host.innerHTML = `<div class="empty">3D kræver internet første gang.</div>`; return; }
  const { vertices: V, faces: F, groups, bounds: b } = mesh3d(m);
  host.innerHTML = "";
  const w = host.clientWidth, h = 360;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0f1218);
  const cam = new THREE.PerspectiveCamera(45, w / h, 100, 200000);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, R = Math.max(b.w, b.d);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(1, 2, 1.5); scene.add(dir);
  const colors = { wall: 0xcdd6e3, slab: 0x9aa3b2, roof: 0xb5654a, default: 0xcccccc };
  // three bruger Y op; vores model har Z op → map (x, z, -y)
  for (const [g, idxs] of Object.entries(groups)) {
    const geom = new THREE.BufferGeometry(); const pos = [];
    for (const fi of idxs) {
      const p = F[fi].v.map((i) => V[i]);
      const tri = (a, c, d) => { for (const q of [a, c, d]) pos.push(q[0], q[2], -q[1]); };
      tri(p[0], p[1], p[2]); if (p.length === 4) tri(p[0], p[2], p[3]);
    }
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geom.computeVertexNormals();
    scene.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: colors[g] || colors.default, side: THREE.DoubleSide, roughness: 0.85, flatShading: true })));
  }
  // enkel bane-kontrol (drag)
  let az = -0.7, el = 0.5, dist = R * 1.8, drag = false, px = 0, py = 0;
  const update = () => { cam.position.set(cx + Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist + m.wallHeight, -cy + Math.sin(az) * Math.cos(el) * dist); cam.lookAt(cx, m.wallHeight / 2, -cy); renderer.render(scene, cam); };
  renderer.domElement.addEventListener("pointerdown", (e) => { drag = true; px = e.clientX; py = e.clientY; });
  addEventListener("pointerup", () => { drag = false; });
  addEventListener("pointermove", (e) => { if (!drag) return; az -= (e.clientX - px) * 0.01; el = Math.max(0.05, Math.min(1.5, el + (e.clientY - py) * 0.01)); px = e.clientX; py = e.clientY; update(); });
  renderer.domElement.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(R * 0.6, Math.min(R * 5, dist * (1 + e.deltaY * 0.001))); update(); }, { passive: false });
  update();
  view3d = { renderer };
}
