// Bygningsberegninger. Rene funktioner uden afhængigheder, så de kan testes (node --test).
// Bemærk: forenklede håndberegninger til overslag. Endelig dokumentation skal følge DS/EN ISO 6946,
// Eurocodes og BR18 – og bærende konstruktioner skal eftervises af en statiker.

/** Overgangsisolanser (m²K/W) efter DS/EN ISO 6946 */
export const RS = {
  vaeg: { rsi: 0.13, rse: 0.04, label: "Væg (vandret varmestrøm)" },
  tag: { rsi: 0.10, rse: 0.04, label: "Loft/tag (opadgående varmestrøm)" },
  gulv: { rsi: 0.17, rse: 0.04, label: "Gulv over det fri (nedadgående varmestrøm)" },
};

/** Typiske λ-værdier (W/mK). Brug altid producentens deklarerede værdi når den kendes. */
export const LAMBDA = {
  "Mineraluld (klasse 37)": 0.037,
  "Mineraluld (klasse 34)": 0.034,
  "Træfiberisolering": 0.038,
  "Papirisolering": 0.040,
  "PIR-isolering": 0.022,
  "EPS (klasse 34)": 0.034,
  "Konstruktionstræ (fyr/gran)": 0.13,
  "Krydsfiner": 0.13,
  "OSB": 0.13,
  "Gipsplade": 0.25,
  "Fibergips": 0.32,
  "Beton": 1.8,
  "Letbeton": 0.18,
  "Tegl (massiv)": 0.6,
  "Hulrum ventileret (medregnes ikke)": 0,
};

/**
 * U-værdi for lagdelt konstruktion. Lag: {navn, d_mm, lambda, traeandel?, lambdaTrae?}
 * Lag med træandel (stolper/spær i isoleringen) regnes forenklet med arealvægtet λ.
 * Lag efter et ventileret hulrum (udvendig beklædning) skal udelades – Rse dækker dem.
 */
export function uValue(lag, type = "vaeg") {
  const rs = RS[type] || RS.vaeg;
  const rows = lag.filter((l) => l.lambda > 0 && l.d_mm > 0).map((l) => {
    const f = Math.min(Math.max((l.traeandel || 0) / 100, 0), 1);
    const lam = f > 0 ? (1 - f) * l.lambda + f * (l.lambdaTrae || 0.13) : l.lambda;
    const R = l.d_mm / 1000 / lam;
    return { ...l, lambdaEff: lam, R };
  });
  const Rtot = rs.rsi + rs.rse + rows.reduce((s, r) => s + r.R, 0);
  return { U: 1 / Rtot, Rtot, rows, rsi: rs.rsi, rse: rs.rse };
}

/** BR18 bilag 2 – mindstekrav (W/m²K). Kilde: bygningsreglementet.dk, tabel 1–4. Kontrollér aktuel version. */
export const BR18_U = {
  nybyggeri: { label: "Nybyggeri – mindstekrav (§ 257, tabel 1)", vaeg: 0.30, tag: 0.20, skillevaeg: 0.40 },
  ombygning: { label: "Ombygning/forandring (tabel 3)", vaeg: 0.18, tag: 0.12, gulv: 0.10 },
  tilbygning: { label: "Ændret anvendelse/tilbygning, rum > 15 °C (tabel 2)", vaeg: 0.15, tag: 0.12, gulv: 0.10 },
  sommerhus: { label: "Sommerhus/feriebolig (tabel 4)", vaeg: 0.25, tag: 0.15, skillevaeg: 0.40 },
};

/** Trappe: etagehøjde (mm) → trin. Bruger tommelfingerreglen 2·stigning + grund ≈ 620 mm. */
export function stairs(etagehoejde_mm, { maalStigning = 180, skridt = 620, faellesAdgangsvej = false } = {}) {
  if (!(etagehoejde_mm > 0)) throw new Error("Angiv etagehøjden i mm");
  const n = Math.max(1, Math.ceil(etagehoejde_mm / maalStigning));
  const stigning = etagehoejde_mm / n;
  const grund = skridt - 2 * stigning;
  const warnings = [];
  if (faellesAdgangsvej && stigning > 180) warnings.push("BR18 § 57: stigningen må højst være 0,18 m i fælles adgangsveje.");
  if (grund < 220) warnings.push("Grunden er meget lille – trappen bliver stejl. Overvej flere trin eller svingtrappe.");
  if (stigning > 210) warnings.push("Stigning over 210 mm er generelt for stejl til en almindelig boligtrappe.");
  return {
    antalStigninger: n, antalTrin: n - 1, stigning_mm: round(stigning, 1), grund_mm: round(grund, 0),
    loebelaengde_mm: round((n - 1) * grund, 0), hældning_grader: round(Math.atan(stigning / grund) * 180 / Math.PI, 1),
    warnings,
  };
}

/** Let skillevæg/forsatsvæg: materialeoverslag. Mål i meter/mm. */
export function wallMaterials({ laengde_m, hoejde_m, cc_mm = 600, pladeB_m = 0.9, pladeH_m = 2.4, lagPlader = 1,
  sider = 2, isoleret = true, spild_pct = 10 }) {
  if (!(laengde_m > 0 && hoejde_m > 0)) throw new Error("Angiv længde og højde");
  const k = 1 + spild_pct / 100;
  const stolper = Math.ceil((laengde_m * 1000) / cc_mm) + 1;
  const areal = laengde_m * hoejde_m;
  const plader = Math.ceil((areal * sider * lagPlader) / (pladeB_m * pladeH_m) * k);
  return {
    areal_m2: round(areal, 2), stolper, stolpe_lm: round(stolper * hoejde_m * k, 1),
    skinner_lm: round(2 * laengde_m * k, 1), plader, isolering_m2: isoleret ? round(areal * k, 1) : 0,
    skruer_ca: Math.ceil(plader * pladeB_m * pladeH_m * 25), // ca. 25 skruer pr. m² plade
  };
}

/** Saddeltag: tagflade, spær og lægter. */
export function roof({ laengde_m, bredde_m, haeldning_grader, udhaeng_m = 0.4, cc_spaer_mm = 900, lægteafstand_mm = 350, spild_pct = 5 }) {
  if (!(laengde_m > 0 && bredde_m > 0 && haeldning_grader > 0 && haeldning_grader < 75)) throw new Error("Ugyldige mål");
  const k = 1 + spild_pct / 100;
  const rad = haeldning_grader * Math.PI / 180;
  const vandretHalv = bredde_m / 2 + udhaeng_m;
  const spaerLaengde = vandretHalv / Math.cos(rad);
  const tagLaengde = laengde_m + 2 * udhaeng_m;
  const tagflade = 2 * spaerLaengde * tagLaengde;
  const antalSpaer = Math.ceil((laengde_m * 1000) / cc_spaer_mm) + 1;
  const raekkerLaegter = Math.ceil((spaerLaengde * 1000) / lægteafstand_mm) + 1;
  return {
    tagflade_m2: round(tagflade * k, 1), spaerlaengde_m: round(spaerLaengde, 2), antalSpaer,
    rygHoejde_m: round((bredde_m / 2) * Math.tan(rad), 2), laegter_lm: round(2 * raekkerLaegter * tagLaengde * k, 0),
  };
}

/** BR18 § 379: glasareal ≥ 10 % af gulvarealet (før korrektioner for skygge, lystransmittans mv.). */
export function daylight(gulvareal_m2, glasareal_m2) {
  const pct = (glasareal_m2 / gulvareal_m2) * 100;
  return { pct: round(pct, 1), ok: pct >= 10, mangler_m2: pct >= 10 ? 0 : round(gulvareal_m2 * 0.1 - glasareal_m2, 2) };
}

/** BR18 §§ 441–447 (boliger): grundluftskifte 0,3 l/s pr. m² og forceret udsugning. */
export function ventilation({ areal_m2, koekkener = 1, badWc = 1, wcUdenBad = 0, bryggers = 0 }) {
  const grund = 0.3 * areal_m2;
  const forceret = koekkener * 20 + badWc * 15 + wcUdenBad * 10 + bryggers * 10;
  return { grundluftskifte_ls: round(grund, 1), grundluftskifte_m3h: round(grund * 3.6, 0), forceretUdsugning_ls: forceret };
}

/** BR18 §§ 297–298 grænseværdier for nybyggeri (kg CO2e/m²/år), ansøgning fra 1. juli 2025. */
export const CO2_LIMITS = {
  "Enfamiliehus, række-/kæde-/dobbelthus, tiny house (≥ 150 m²)": { 2025: 6.7, 2027: 6.0, 2029: 5.4 },
  "Feriebolig under 150 m²": { 2025: 4.0, 2027: 3.6, 2029: 3.2 },
  "Etagebolig": { 2025: 7.5, 2027: 6.8, 2029: 6.1 },
  "Kontorbygning": { 2025: 7.5, 2027: 6.8, 2029: 6.1 },
  "Institution": { 2025: 8.0, 2027: 7.2, 2029: 6.4 },
};

export function round(v, d = 2) { const p = 10 ** d; return Math.round(v * p) / p; }
