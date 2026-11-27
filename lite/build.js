// Fanen "Byg": beregnere til bygningskonstruktøren. Tallene regnes eksakt i kode – ikke af AI'en.
import { $, esc, state, save, uid, toast } from "./core.js";
import { BR18_U, CO2_LIMITS, LAMBDA, RS, daylight, roof, stairs, uValue, ventilation, wallMaterials } from "./calc.js";
import { renderDrawing } from "./cad-ui.js";

const TOOLS = [["tegning", "📐 Tegning"], ["u", "U-værdi"], ["trappe", "Trappe"], ["vaeg", "Skillevæg"], ["tag", "Tag"], ["dagslys", "Dagslys"], ["vent", "Ventilation"], ["co2", "CO₂-krav"]];
let current = "tegning";
let layers = null;

const num = (id) => parseFloat(String($(id)?.value || "").replace(",", "."));
const f = (v, d = 2) => Number(v).toLocaleString("da-DK", { maximumFractionDigits: d });

export function renderBuild() {
  const v = $("#view");
  v.innerHTML = `<h2>Byggeberegnere</h2>
    <div class="segment" id="seg">${TOOLS.map(([k, l]) => `<button data-k="${k}" class="${k === current ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="tool"></div>
    <p class="muted">Beregnerne er til overslag og kontrol. Kravene er hentet fra BR18 (se fanen Viden for kilder) – kontrollér altid den aktuelle udgave på bygningsreglementet.dk, og lad en statiker eftervise bærende konstruktioner.</p>`;
  $("#seg").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { current = b.dataset.k; renderBuild(); } };
  if (current === "tegning") return renderDrawing($("#tool"));
  ({ u: uTool, trappe: stairTool, vaeg: wallTool, tag: roofTool, dagslys: dayTool, vent: ventTool, co2: co2Tool })[current]();
}

function card(html) { $("#tool").innerHTML = `<div class="card">${html}</div>`; }
function saveToKnowledge(title, text) {
  state.knowledge.unshift({ id: uid(), kind: "fact", title, text, category: "Mine beregninger", source: "Byggeberegner", createdAt: Date.now() });
  save("knowledge"); toast("Gemt i Viden – Jarvis kan nu henvise til beregningen");
}

// ---------- U-værdi ----------
function uTool() {
  layers ||= [
    { navn: "Gipsplade", d_mm: 13, lambda: 0.25 },
    { navn: "Mineraluld (klasse 37)", d_mm: 45, lambda: 0.037, traeandel: 10 },
    { navn: "Mineraluld (klasse 37)", d_mm: 195, lambda: 0.037, traeandel: 10 },
    { navn: "Mineraluld (klasse 34)", d_mm: 45, lambda: 0.034 },
  ];
  const opts = Object.entries(LAMBDA).map(([n, l]) => `<option value="${esc(n)}" data-l="${l}">${esc(n)} (λ ${l})</option>`).join("");
  card(`<h3 style="margin-top:0">U-værdi for lagdelt konstruktion</h3>
    <div class="grid2"><label>Bygningsdel<select id="uType">${Object.entries(RS).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join("")}</select></label>
    <label>Sammenlign med<select id="uReq">${Object.entries(BR18_U).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join("")}</select></label></div>
    <h3>Lag (indefra og ud – stop ved ventileret hulrum)</h3><div id="layers"></div>
    <div class="row" style="margin-top:8px"><select id="addSel" class="grow">${opts}</select><button class="btn sub" id="addL">＋ Lag</button></div>
    <div id="uRes" class="result"></div>`);
  const draw = () => {
    $("#layers").innerHTML = layers.map((l, i) => `<div class="row" data-i="${i}" style="margin-bottom:6px">
      <input class="grow" data-f="navn" value="${esc(l.navn)}" />
      <input data-f="d_mm" type="number" inputmode="decimal" value="${l.d_mm}" style="flex:0 0 78px" title="Tykkelse mm" />
      <input data-f="lambda" type="number" step="0.001" inputmode="decimal" value="${l.lambda}" style="flex:0 0 78px" title="λ W/mK" />
      <input data-f="traeandel" type="number" inputmode="decimal" value="${l.traeandel || 0}" style="flex:0 0 64px" title="Træandel %" />
      <button class="x" data-del>✕</button></div>`).join("") +
      `<div class="muted" style="font-size:12px">Kolonner: navn · tykkelse (mm) · λ (W/mK) · træandel % (stolper/spær i laget, typisk 8–12 %)</div>`;
    calc();
  };
  const calc = () => {
    const type = $("#uType").value;
    const r = uValue(layers, type);
    const req = BR18_U[$("#uReq").value];
    const key = type === "tag" ? "tag" : type === "gulv" ? "gulv" : "vaeg";
    const limit = req[key];
    $("#uRes").innerHTML = `U-værdi: <b>${f(r.U, 3)} W/m²K</b> · R<sub>total</sub> ${f(r.Rtot, 2)} m²K/W<br>
      ${limit ? (r.U <= limit ? `<span class="badge ok">Overholder ${f(limit)} W/m²K</span>` : `<span class="badge bad">Overskrider kravet på ${f(limit)} W/m²K</span>`) : `<span class="badge">Intet krav for denne bygningsdel i valgt tabel</span>`}
      <div class="muted" style="margin-top:6px;font-size:12px">Rsi ${r.rsi} + ${r.rows.map((x) => `${esc(x.navn)} ${f(x.R, 3)}`).join(" + ")} + Rse ${r.rse}. Forenklet metode (arealvægtet λ for træ) – til endelig dokumentation bruges DS/EN ISO 6946.</div>
      <button class="btn sm sub" id="uSave" style="margin-top:8px">Gem i Viden</button>`;
    $("#uSave").onclick = () => saveToKnowledge(`U-værdi: ${layers.map((l) => l.d_mm + " mm " + l.navn).join(" / ")}`,
      `Konstruktion (${RS[type].label}): ${layers.map((l) => `${l.d_mm} mm ${l.navn} (λ ${l.lambda}${l.traeandel ? `, ${l.traeandel}% træ` : ""})`).join(", ")}. Beregnet U-værdi ${f(r.U, 3)} W/m²K.`);
  };
  $("#layers").addEventListener("input", (e) => {
    const i = +e.target.closest("[data-i]").dataset.i, k = e.target.dataset.f;
    layers[i][k] = k === "navn" ? e.target.value : parseFloat(e.target.value.replace(",", ".")) || 0; calc();
  });
  $("#layers").addEventListener("click", (e) => { if (e.target.closest("[data-del]")) { layers.splice(+e.target.closest("[data-i]").dataset.i, 1); draw(); } });
  $("#addL").onclick = () => { const o = $("#addSel").selectedOptions[0]; layers.push({ navn: o.value, d_mm: 50, lambda: +o.dataset.l }); draw(); };
  $("#uType").onchange = calc; $("#uReq").onchange = calc;
  draw();
}

// ---------- Trappe ----------
function stairTool() {
  card(`<h3 style="margin-top:0">Trappeberegner</h3>
    <div class="grid2"><label>Etagehøjde, færdigt gulv til færdigt gulv (mm)<input id="sH" type="number" inputmode="numeric" value="2800" /></label>
    <label>Ønsket maks. stigning (mm)<input id="sMax" type="number" inputmode="numeric" value="180" /></label>
    <label>Skridtlængde 2s+g (mm)<input id="sSk" type="number" inputmode="numeric" value="620" /></label>
    <label>Anvendelse<select id="sF"><option value="0">Inde i boligen</option><option value="1">Fælles adgangsvej (BR18 § 57)</option></select></label></div>
    <div id="sRes" class="result"></div>`);
  const calc = () => {
    try {
      const r = stairs(num("#sH"), { maalStigning: num("#sMax"), skridt: num("#sSk"), faellesAdgangsvej: $("#sF").value === "1" });
      $("#sRes").innerHTML = `<b>${r.antalStigninger} stigninger á ${f(r.stigning_mm, 1)} mm</b> · grund ${f(r.grund_mm, 0)} mm<br>
        ${r.antalTrin} trin · løbelængde ca. ${f(r.loebelaengde_mm / 1000, 2)} m · hældning ${f(r.hældning_grader, 1)}°
        ${r.warnings.map((w) => `<div class="badge warn" style="display:block;margin-top:6px;white-space:normal">${esc(w)}</div>`).join("")}
        <div class="muted" style="font-size:12px;margin-top:6px">Husk: fri højde over ganglinjen, værn min. 0,80 m ved trapper og 0,90 m over reposer (BR18 §§ 58–60).</div>`;
    } catch (e) { $("#sRes").textContent = e.message; }
  };
  $("#tool").oninput = calc; calc();
}

// ---------- Skillevæg ----------
function wallTool() {
  card(`<h3 style="margin-top:0">Let skillevæg – materialeoverslag</h3>
    <div class="grid2"><label>Længde (m)<input id="wL" type="number" inputmode="decimal" value="4" /></label>
    <label>Højde (m)<input id="wH" type="number" inputmode="decimal" value="2.5" /></label>
    <label>Stolpeafstand c/c (mm)<select id="wCC"><option>450</option><option selected>600</option></select></label>
    <label>Lag plader pr. side<select id="wLag"><option>1</option><option selected>2</option></select></label>
    <label>Beklædte sider<select id="wS"><option>1</option><option selected>2</option></select></label>
    <label>Pladeformat<select id="wP"><option value="0.9x2.4">900 × 2400</option><option value="1.2x2.4">1200 × 2400</option><option value="1.2x2.7">1200 × 2700</option></select></label>
    <label>Spild (%)<input id="wSp" type="number" value="10" /></label>
    <label>Isoleret<select id="wI"><option value="1">Ja</option><option value="0">Nej</option></select></label></div>
    <div id="wRes" class="result"></div>`);
  const calc = () => {
    try {
      const [pb, ph] = $("#wP").value.split("x").map(Number);
      const r = wallMaterials({ laengde_m: num("#wL"), hoejde_m: num("#wH"), cc_mm: num("#wCC"), lagPlader: num("#wLag"), sider: num("#wS"),
        pladeB_m: pb, pladeH_m: ph, isoleret: $("#wI").value === "1", spild_pct: num("#wSp") });
      $("#wRes").innerHTML = `Vægareal <b>${f(r.areal_m2)} m²</b><br>• ${r.stolper} stolper (${f(r.stolpe_lm, 1)} lbm)<br>• Skinner/rem: ${f(r.skinner_lm, 1)} lbm<br>
        • ${r.plader} plader<br>${r.isolering_m2 ? `• Isolering: ${f(r.isolering_m2, 1)} m²<br>` : ""}• Skruer: ca. ${r.skruer_ca} stk.
        <div class="muted" style="font-size:12px;margin-top:6px">Inkl. spild. Tjek producentens montagevejledning for brand-/lydkrav (fx forskudte samlinger ved 2 lag).</div>`;
    } catch (e) { $("#wRes").textContent = e.message; }
  };
  $("#tool").oninput = calc; calc();
}

// ---------- Tag ----------
function roofTool() {
  card(`<h3 style="margin-top:0">Saddeltag – tagflade, spær og lægter</h3>
    <div class="grid2"><label>Husets længde (m)<input id="rL" type="number" inputmode="decimal" value="12" /></label>
    <label>Husets bredde (m)<input id="rB" type="number" inputmode="decimal" value="8" /></label>
    <label>Taghældning (°)<input id="rA" type="number" inputmode="decimal" value="30" /></label>
    <label>Udhæng (m)<input id="rU" type="number" inputmode="decimal" value="0.4" /></label>
    <label>Spærafstand c/c (mm)<input id="rC" type="number" value="900" /></label>
    <label>Lægteafstand (mm)<input id="rLa" type="number" value="350" /></label></div>
    <div id="rRes" class="result"></div>`);
  const calc = () => {
    try {
      const r = roof({ laengde_m: num("#rL"), bredde_m: num("#rB"), haeldning_grader: num("#rA"), udhaeng_m: num("#rU"), cc_spaer_mm: num("#rC"), lægteafstand_mm: num("#rLa") });
      $("#rRes").innerHTML = `Tagflade <b>${f(r.tagflade_m2, 1)} m²</b> (inkl. 5 % spild)<br>• ${r.antalSpaer} spær · spærlængde ca. ${f(r.spaerlaengde_m)} m (vandret mål / cos α)<br>
        • Rygningshøjde over rem: ${f(r.rygHoejde_m)} m<br>• Lægter: ca. ${f(r.laegter_lm, 0)} lbm
        <div class="muted" style="font-size:12px;margin-top:6px">Lægteafstand afhænger af tagbelægningen – brug producentens anvisning. Spærdimensioner skal fremgå af spærleverandørens statiske beregning.</div>`;
    } catch (e) { $("#rRes").textContent = e.message; }
  };
  $("#tool").oninput = calc; calc();
}

// ---------- Dagslys ----------
function dayTool() {
  card(`<h3 style="margin-top:0">Dagslys – 10 %-reglen (BR18 § 379)</h3>
    <div class="grid2"><label>Gulvareal (m²)<input id="dG" type="number" inputmode="decimal" value="16" /></label>
    <label>Samlet glasareal (m², uden karm/ramme)<input id="dA" type="number" inputmode="decimal" value="1.4" /></label></div>
    <div id="dRes" class="result"></div>`);
  const calc = () => {
    const r = daylight(num("#dG"), num("#dA"));
    $("#dRes").innerHTML = `Glasareal = <b>${f(r.pct, 1)} %</b> af gulvarealet ${r.ok ? `<span class="badge ok">OK</span>` : `<span class="badge bad">Mangler ${f(r.mangler_m2)} m² glas</span>`}
      <div class="muted" style="font-size:12px;margin-top:6px">Glasarealet skal korrigeres for skygge, lystransmittans mv. efter BR18's vejledning.</div>`;
  };
  $("#tool").oninput = calc; calc();
}

// ---------- Ventilation ----------
function ventTool() {
  card(`<h3 style="margin-top:0">Ventilation i bolig (BR18 §§ 441–447)</h3>
    <div class="grid2"><label>Opvarmet etageareal (m²)<input id="vA" type="number" value="140" /></label>
    <label>Køkkener<input id="vK" type="number" value="1" /></label>
    <label>Bad/wc<input id="vB" type="number" value="2" /></label>
    <label>Wc uden bad<input id="vW" type="number" value="0" /></label>
    <label>Bryggers<input id="vBr" type="number" value="1" /></label></div>
    <div id="vRes" class="result"></div>`);
  const calc = () => {
    const r = ventilation({ areal_m2: num("#vA"), koekkener: num("#vK"), badWc: num("#vB"), wcUdenBad: num("#vW"), bryggers: num("#vBr") });
    $("#vRes").innerHTML = `Grundluftskifte: <b>${f(r.grundluftskifte_ls, 1)} l/s</b> (${f(r.grundluftskifte_m3h, 0)} m³/h)<br>
      Forceret udsugning samlet: ${r.forceretUdsugning_ls} l/s (køkken 20, bad/wc 15, wc og bryggers 10 l/s hver)`;
  };
  $("#tool").oninput = calc; calc();
}

// ---------- CO2 ----------
function co2Tool() {
  card(`<h3 style="margin-top:0">Klimakrav – grænseværdier (BR18 §§ 297–298)</h3>
    <div class="tr" style="display:flex;font-weight:600;font-size:13px;border-bottom:1px solid var(--line);padding:4px 0"><span style="flex:3">Bygningstype</span><span style="flex:1">2025</span><span style="flex:1">2027</span><span style="flex:1">2029</span></div>
    ${Object.entries(CO2_LIMITS).map(([k, v]) => `<div style="display:flex;font-size:13px;border-bottom:1px solid var(--line);padding:5px 0"><span style="flex:3">${esc(k)}</span><span style="flex:1">${f(v[2025], 1)}</span><span style="flex:1">${f(v[2027], 1)}</span><span style="flex:1">${f(v[2029], 1)}</span></div>`).join("")}
    <p class="muted" style="font-size:12.5px">kg CO₂e pr. m² pr. år for ansøgninger om byggetilladelse fra 1. juli 2025. Værdierne for 2027 og 2029 er de politisk aftalte skærpelser – tjek om de er trådt i kraft. Byggeprocessen (A4–A5) højst 1,5 kg CO₂e/m²/år. Tilbygninger til småhuse under 250 m² og uopvarmede bygninger under 50 m² er undtaget.</p>`);
}
