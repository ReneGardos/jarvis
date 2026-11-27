// Funktionsmenu i chatten (ChatGPT-stil) + beregnere som AI-værktøjer.
// Beregnere kan både vælges fra menuen (inline-kort i chatten) OG kaldes af AI'en i naturligt sprog.
import { $, AGENTS, esc, save, state, toast, uid } from "./core.js";
import { BR18_U, CO2_LIMITS, LAMBDA, RS, daylight, roof, stairs, uValue, ventilation, wallMaterials } from "./calc.js";
import { dawa, weather, WMO } from "./research.js";

// ---------------- AI-værktøjer (eksakte beregninger, kaldt af modellen) ----------------
export const calcTools = {
  trappe: {
    desc: '{"tool":"trappe","etagehoejde_mm":2800,"faelles":false} – beregner trappe (stigninger, grund, hældning).',
    run: (a) => { const r = stairs(+a.etagehoejde_mm, { faellesAdgangsvej: !!a.faelles }); return `${r.antalStigninger} stigninger á ${r.stigning_mm} mm, grund ${r.grund_mm} mm, hældning ${r.hældning_grader}°${r.warnings.length ? " – " + r.warnings.join(" ") : ""}`; },
  },
  dagslys: {
    desc: '{"tool":"dagslys","gulvareal_m2":16,"glasareal_m2":1.6} – tjekker BR18 10%-dagslysregel.',
    run: (a) => { const r = daylight(+a.gulvareal_m2, +a.glasareal_m2); return `Glasareal = ${r.pct}% af gulvet. ${r.ok ? "Opfylder 10%-reglen (§ 379)." : `Mangler ${r.mangler_m2} m² glas.`}`; },
  },
  ventilation: {
    desc: '{"tool":"ventilation","areal_m2":120,"koekkener":1,"badWc":2,"wcUdenBad":0,"bryggers":1} – boligventilation.',
    run: (a) => { const r = ventilation({ areal_m2: +a.areal_m2, koekkener: +a.koekkener || 1, badWc: +a.badWc || 1, wcUdenBad: +a.wcUdenBad || 0, bryggers: +a.bryggers || 0 }); return `Grundluftskifte ${r.grundluftskifte_ls} l/s (${r.grundluftskifte_m3h} m³/h). Forceret udsugning i alt ${r.forceretUdsugning_ls} l/s.`; },
  },
  materialer: {
    desc: '{"tool":"materialer","laengde_m":4,"hoejde_m":2.5,"sider":2,"lagPlader":1} – materialer til let skillevæg.',
    run: (a) => { const r = wallMaterials({ laengde_m: +a.laengde_m, hoejde_m: +a.hoejde_m, sider: +a.sider || 2, lagPlader: +a.lagPlader || 1, cc_mm: +a.cc_mm || 600, pladeB_m: 0.9, pladeH_m: 2.4 }); return `${r.areal_m2} m²: ${r.stolper} stolper (${r.stolpe_lm} lbm), ${r.skinner_lm} lbm skinner, ${r.plader} plader, ${r.isolering_m2} m² isolering, ca. ${r.skruer_ca} skruer.`; },
  },
  co2: {
    desc: '{"tool":"co2","type":"Etagebolig"} – BR18 CO2-grænseværdi for en bygningstype.',
    run: (a) => { const k = Object.keys(CO2_LIMITS).find((x) => x.toLowerCase().includes(String(a.type || "").toLowerCase())) || "Etagebolig"; const v = CO2_LIMITS[k]; return `${k}: grænseværdi ${v[2025]} kg CO₂e/m²/år (2025), ${v[2027]} (2027), ${v[2029]} (2029). Byggeproces maks. 1,5 kg.`; },
  },
};

export function calcToolInstructions() {
  return "Når brugeren beder om en byggeberegning, så brug et VÆRKTØJ i stedet for at regne selv. Svar da KUN med én JSON-blok:\n```json\n" +
    Object.values(calcTools).map((t) => t.desc).join("\n") + "\n```\nDu får det eksakte resultat tilbage og forklarer det kort.";
}

/** Find og udfør værktøjskald i modellens svar. Returnerer {text, results:[...]}. */
export function runCalcTools(raw) {
  const results = [];
  const clean = raw.replace(/```json\s*(\{[\s\S]*?\})\s*```/g, (m, j) => {
    try { const o = JSON.parse(j); const t = calcTools[o.tool]; if (t) { results.push({ tool: o.tool, out: t.run(o) }); return ""; } } catch {}
    return m;
  });
  return { text: clean.trim(), results };
}

// ---------------- Funktionsmenu (bottom sheet i chatten) ----------------
const TOOLS = [
  ["tegning", "📐", "Tegning", "Lav CAD-tegning i 2D/3D"],
  ["code", "⌨️", "Kode", "Byg hjemmesider og webprojekter"],
  ["research", "🔎", "Undersøg", "Søg på nettet med kilder"],
  ["image", "🖼️", "Billede", "Vedhæft et billede"],
  ["adresse", "📍", "Adresse", "Slå en dansk adresse op"],
  ["vejr", "🌤️", "Vejr", "Vejr på byggepladsen"],
  ["uvaerdi", "📏", "U-værdi", "Isolering og varmetab"],
  ["trappe", "🪜", "Trappe", "Stigninger og grund"],
  ["materialer", "🧱", "Materialer", "Mængder til skillevæg"],
  ["dagslys", "☀️", "Dagslys", "10%-reglen"],
  ["ventilation", "💨", "Ventilation", "Luftskifte i bolig"],
  ["co2", "🌍", "CO₂-krav", "Klimagrænseværdier"],
];

export function renderFunctionSheet(onPick) {
  const el = document.createElement("div");
  el.className = "sheet-wrap"; el.id = "fnSheet";
  el.innerHTML = `<div class="sheet-bg"></div><div class="sheet-panel">
    <div class="sheet-grip"></div>
    <h3 style="margin:2px 0 10px">Funktioner</h3>
    <div class="fn-grid">${TOOLS.map(([k, ic, name, sub]) => `<button data-fn="${k}"><span>${ic}</span><b>${name}</b><small>${sub}</small></button>`).join("")}</div>
    <h3 style="margin:16px 0 10px">Skift assistent</h3>
    <div class="fn-agents">${Object.entries(AGENTS).map(([k, a]) => `<button data-agent="${k}">${a.icon} ${a.name}</button>`).join("")}</div>
  </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.addEventListener("click", (e) => {
    if (e.target.closest(".sheet-bg")) return close();
    const fn = e.target.closest("[data-fn]"); const ag = e.target.closest("[data-agent]");
    if (fn) { onPick({ type: "tool", id: fn.dataset.fn }); close(); }
    if (ag) { onPick({ type: "agent", id: ag.dataset.agent }); close(); }
  });
}

// ---------------- Inline-beregnere (kort i chatflowet) ----------------
const num = (el, id) => parseFloat(String(el.querySelector(id)?.value || "").replace(",", ".")) || 0;
const f = (v, d = 2) => Number(v).toLocaleString("da-DK", { maximumFractionDigits: d });

/** Indsætter et interaktivt beregnerkort i en container. onSave(title,text) gemmer i chat/viden. */
export function inlineCalc(name, host, onResult) {
  const card = document.createElement("div");
  card.className = "msg bot calc-card";
  host.appendChild(card);
  ({ uvaerdi: uCalc, trappe: trappeCalc, materialer: matCalc, dagslys: dayCalc, ventilation: ventCalc, co2: co2Calc, adresse: addrCalc, vejr: weatherCalc })[name](card, onResult);
  card.scrollIntoView({ behavior: "smooth", block: "end" });
  return card;
}

const head = (title) => `<div style="font-weight:600;color:var(--accent);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;font-size:12px">${title}</div>`;

function uCalc(card, onResult) {
  const presets = {
    "Ydervæg, træ 300 mm": [{ navn: "Gips", d_mm: 13, lambda: 0.25 }, { navn: "Mineraluld", d_mm: 300, lambda: 0.037, traeandel: 10 }],
    "Ydervæg, træ 195 mm": [{ navn: "Gips", d_mm: 13, lambda: 0.25 }, { navn: "Mineraluld", d_mm: 195, lambda: 0.037, traeandel: 10 }],
    "Loft/tag 400 mm": [{ navn: "Gips", d_mm: 13, lambda: 0.25 }, { navn: "Mineraluld", d_mm: 400, lambda: 0.037, traeandel: 8 }],
    "Terrændæk 300 mm EPS": [{ navn: "Beton", d_mm: 100, lambda: 1.8 }, { navn: "EPS", d_mm: 300, lambda: 0.034 }],
  };
  card.innerHTML = head("📏 U-værdi") +
    `<label>Konstruktion<select data-k="preset">${Object.keys(presets).map((p) => `<option>${p}</option>`).join("")}</select></label>
     <label style="margin-top:8px">Isoleringstykkelse (mm)<input data-k="iso" type="number" value="300" /></label>
     <label style="margin-top:8px">Krav<select data-k="req">${Object.entries(BR18_U).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join("")}</select></label>
     <div data-k="res" class="result"></div>`;
  const calc = () => {
    const preset = card.querySelector("[data-k=preset]").value;
    const iso = num(card, "[data-k=iso]");
    const lag = presets[preset].map((l) => (l.lambda <= 0.045 ? { ...l, d_mm: iso } : l));
    const type = preset.includes("Loft") || preset.includes("tag") ? "tag" : preset.includes("dæk") || preset.includes("Terræn") ? "gulv" : "vaeg";
    const r = uValue(lag, type);
    const reqKey = card.querySelector("[data-k=req]").value;
    const limit = BR18_U[reqKey][type === "tag" ? "tag" : type === "gulv" ? "gulv" : "vaeg"];
    card.querySelector("[data-k=res]").innerHTML = `U-værdi <b>${f(r.U, 3)} W/m²K</b> ${limit ? (r.U <= limit ? `<span class="badge ok">OK (krav ${f(limit)})</span>` : `<span class="badge bad">Over krav ${f(limit)}</span>`) : ""}`;
    onResult?.(`U-værdi for ${preset} med ${iso} mm isolering: ${f(r.U, 3)} W/m²K`);
  };
  card.addEventListener("input", calc); calc();
}

function trappeCalc(card, onResult) {
  card.innerHTML = head("🪜 Trappe") +
    `<label>Etagehøjde, gulv til gulv (mm)<input data-k="h" type="number" value="2800" /></label>
     <label style="margin-top:8px">Anvendelse<select data-k="f"><option value="0">I boligen</option><option value="1">Fælles adgangsvej</option></select></label>
     <div data-k="res" class="result"></div>`;
  const calc = () => {
    try { const r = stairs(num(card, "[data-k=h]"), { faellesAdgangsvej: card.querySelector("[data-k=f]").value === "1" });
      card.querySelector("[data-k=res]").innerHTML = `<b>${r.antalStigninger} stigninger á ${f(r.stigning_mm, 1)} mm</b>, grund ${f(r.grund_mm, 0)} mm, ${r.antalTrin} trin, hældning ${r.hældning_grader}°${r.warnings.map((w) => `<div class="badge warn" style="display:block;margin-top:6px;white-space:normal">${esc(w)}</div>`).join("")}`;
      onResult?.(`Trappe for ${num(card, "[data-k=h]")} mm etagehøjde: ${r.antalStigninger} stigninger á ${r.stigning_mm} mm, grund ${r.grund_mm} mm`);
    } catch (e) { card.querySelector("[data-k=res]").textContent = e.message; }
  };
  card.addEventListener("input", calc); calc();
}

function matCalc(card, onResult) {
  card.innerHTML = head("🧱 Materialer – skillevæg") +
    `<div class="grid2"><label>Længde (m)<input data-k="l" type="number" value="4" /></label><label>Højde (m)<input data-k="hh" type="number" value="2.5" /></label>
     <label>Sider<select data-k="s"><option>1</option><option selected>2</option></select></label><label>Lag pr. side<select data-k="lag"><option selected>1</option><option>2</option></select></label></div>
     <div data-k="res" class="result"></div>`;
  const calc = () => {
    const r = wallMaterials({ laengde_m: num(card, "[data-k=l]"), hoejde_m: num(card, "[data-k=hh]"), sider: +card.querySelector("[data-k=s]").value, lagPlader: +card.querySelector("[data-k=lag]").value, cc_mm: 600, pladeB_m: 0.9, pladeH_m: 2.4 });
    card.querySelector("[data-k=res]").innerHTML = `<b>${f(r.areal_m2)} m²</b>: ${r.stolper} stolper (${f(r.stolpe_lm, 1)} lbm), ${f(r.skinner_lm, 1)} lbm skinner, ${r.plader} plader, ${f(r.isolering_m2, 1)} m² isolering, ca. ${r.skruer_ca} skruer`;
    onResult?.(`Materialer til ${f(r.areal_m2)} m² skillevæg: ${r.stolper} stolper, ${r.plader} plader`);
  };
  card.addEventListener("input", calc); calc();
}

function dayCalc(card, onResult) {
  card.innerHTML = head("☀️ Dagslys") +
    `<div class="grid2"><label>Gulvareal (m²)<input data-k="g" type="number" value="16" /></label><label>Glasareal (m²)<input data-k="a" type="number" value="1.6" /></label></div><div data-k="res" class="result"></div>`;
  const calc = () => { const r = daylight(num(card, "[data-k=g]"), num(card, "[data-k=a]")); card.querySelector("[data-k=res]").innerHTML = `<b>${f(r.pct, 1)}%</b> ${r.ok ? `<span class="badge ok">OK</span>` : `<span class="badge bad">mangler ${f(r.mangler_m2)} m²</span>`}`; onResult?.(`Dagslys: ${f(r.pct, 1)}% af gulvareal`); };
  card.addEventListener("input", calc); calc();
}

function ventCalc(card, onResult) {
  card.innerHTML = head("💨 Ventilation") +
    `<div class="grid2"><label>Areal (m²)<input data-k="a" type="number" value="120" /></label><label>Køkkener<input data-k="k" type="number" value="1" /></label><label>Bad/wc<input data-k="b" type="number" value="2" /></label><label>Bryggers<input data-k="br" type="number" value="1" /></label></div><div data-k="res" class="result"></div>`;
  const calc = () => { const r = ventilation({ areal_m2: num(card, "[data-k=a]"), koekkener: num(card, "[data-k=k]"), badWc: num(card, "[data-k=b]"), bryggers: num(card, "[data-k=br]") }); card.querySelector("[data-k=res]").innerHTML = `Grundluftskifte <b>${f(r.grundluftskifte_ls, 1)} l/s</b> · forceret ${r.forceretUdsugning_ls} l/s`; onResult?.(`Ventilation: grundluftskifte ${r.grundluftskifte_ls} l/s`); };
  card.addEventListener("input", calc); calc();
}

function co2Calc(card, onResult) {
  card.innerHTML = head("🌍 CO₂-krav") +
    `<label>Bygningstype<select data-k="t">${Object.keys(CO2_LIMITS).map((k) => `<option>${k}</option>`).join("")}</select></label><div data-k="res" class="result"></div>`;
  const calc = () => { const v = CO2_LIMITS[card.querySelector("[data-k=t]").value]; card.querySelector("[data-k=res]").innerHTML = `Grænseværdi <b>${f(v[2025], 1)}</b> kg CO₂e/m²/år (2025) · ${f(v[2027], 1)} (2027) · ${f(v[2029], 1)} (2029)`; };
  card.addEventListener("input", calc); calc();
}

function addrCalc(card, onResult) {
  card.innerHTML = head("📍 Adresseopslag") +
    `<input data-k="q" placeholder="Skriv en adresse, fx Rådhuspladsen 1, København" autocomplete="off" />
     <div data-k="res" style="margin-top:8px"></div>`;
  let t;
  const q = card.querySelector("[data-k=q]"), res = card.querySelector("[data-k=res]");
  q.addEventListener("input", () => {
    clearTimeout(t);
    if (q.value.trim().length < 3) { res.innerHTML = ""; return; }
    res.innerHTML = `<span class="muted">Søger…</span>`;
    t = setTimeout(async () => {
      try {
        const list = await dawa(q.value.trim());
        if (!list.length) { res.innerHTML = `<span class="muted">Ingen match</span>`; return; }
        res.innerHTML = list.slice(0, 5).map((a, i) => `<button class="btn sub sm" data-i="${i}" style="display:block;width:100%;text-align:left;margin-bottom:4px">${esc(a.tekst)}</button>`).join("");
        res.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => {
          const a = list[+b.dataset.i];
          res.innerHTML = `<div class="result"><b style="font-size:15px">${esc(a.tekst)}</b><br>${a.kommune ? esc(a.kommune) + " Kommune<br>" : ""}
            Koordinater: ${a.lat?.toFixed(5)}, ${a.lon?.toFixed(5)}<br>
            <a href="https://www.google.com/maps?q=${a.lat},${a.lon}" target="_blank" rel="noopener">Kort</a> ·
            <a href="https://bbr.dk/se-bbr-oplysninger" target="_blank" rel="noopener">BBR-opslag</a></div>`;
          onResult?.(`Adresse: ${a.tekst} (${a.lat}, ${a.lon})`);
        });
      } catch (e) { res.innerHTML = `<span class="badge bad">${esc(e.message)}</span>`; }
    }, 350);
  });
}

function weatherCalc(card, onResult) {
  card.innerHTML = head("🌤️ Vejr på byggepladsen") +
    `<div class="row"><button class="btn sub sm" data-k="geo">📍 Min placering</button><input data-k="q" class="grow" placeholder="eller skriv en adresse" /></div>
     <div data-k="res" style="margin-top:8px"></div>`;
  const res = card.querySelector("[data-k=res]");
  const show = async (lat, lon, label) => {
    res.innerHTML = `<span class="muted">Henter vejr…</span>`;
    try {
      const d = await weather(lat, lon);
      const c = d.current, days = d.daily;
      const day = (i) => `<div style="flex:1;text-align:center"><div class="muted" style="font-size:11px">${["Søn","Man","Tir","Ons","Tor","Fre","Lør"][new Date(days.time[i]).getDay()]}</div>
        <div style="font-size:20px">${(WMO[days.weather_code[i]] || "").split(" ")[0]}</div>
        <div><b>${Math.round(days.temperature_2m_max[i])}°</b> <span class="muted">${Math.round(days.temperature_2m_min[i])}°</span></div>
        <div class="muted" style="font-size:10px">${days.precipitation_sum[i]} mm · ${Math.round(days.wind_speed_10m_max[i])} m/s</div></div>`;
      res.innerHTML = `<div class="result">${label ? `<div class="muted">${esc(label)}</div>` : ""}
        <div style="font-size:15px;margin:4px 0"><b>${Math.round(c.temperature_2m)}°C</b> ${WMO[c.weather_code] || ""} · vind ${Math.round(c.wind_speed_10m)} m/s · nedbør ${c.precipitation} mm</div>
        <div style="display:flex;gap:6px;margin-top:8px">${[0, 1, 2, 3].map(day).join("")}</div></div>`;
      onResult?.(`Vejr ${label || ""}: ${Math.round(c.temperature_2m)}°C, ${(WMO[c.weather_code] || "").replace(/^\S+\s/, "")}`);
    } catch (e) { res.innerHTML = `<span class="badge bad">${esc(e.message)}</span>`; }
  };
  card.querySelector("[data-k=geo]").onclick = () => {
    res.innerHTML = `<span class="muted">Finder din placering…</span>`;
    navigator.geolocation?.getCurrentPosition((p) => show(p.coords.latitude, p.coords.longitude, "Din placering"),
      () => res.innerHTML = `<span class="badge warn">Kunne ikke få placering – skriv en adresse i stedet</span>`);
  };
  let t; card.querySelector("[data-k=q]").addEventListener("input", (e) => {
    clearTimeout(t); const v = e.target.value.trim(); if (v.length < 3) return;
    t = setTimeout(async () => { try { const a = (await dawa(v))[0]; if (a) show(a.lat, a.lon, a.tekst); } catch {} }, 500);
  });
}
