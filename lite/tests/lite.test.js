import { test } from "node:test";
import assert from "node:assert/strict";
import { uValue, stairs, wallMaterials, roof, daylight, ventilation, BR18_U } from "../calc.js";
import { tokenize, chunk, buildIndex, search } from "../search.js";
import { md, esc } from "../md.js";
import { parseFileBlocks, buildPreview } from "../code.js";
import { parseActions, stripActions, buildContext, state } from "../core.js";
import { SEED } from "../knowledge/br18.js";

test("U-værdi: kendt eksempel 300 mm mineraluld", () => {
  // Rsi 0,13 + 0,3/0,037 + Rse 0,04 = 8,278 → U = 0,1208
  const r = uValue([{ navn: "iso", d_mm: 300, lambda: 0.037 }], "vaeg");
  assert.ok(Math.abs(r.U - 1 / (0.13 + 0.3 / 0.037 + 0.04)) < 1e-9);
  assert.ok(r.U < BR18_U.tilbygning.vaeg);
});

test("U-værdi: træandel forværrer U-værdien, nul-lag ignoreres", () => {
  const ren = uValue([{ d_mm: 200, lambda: 0.037 }]).U;
  const traeholdig = uValue([{ d_mm: 200, lambda: 0.037, traeandel: 10 }]).U;
  assert.ok(traeholdig > ren);
  assert.equal(uValue([{ d_mm: 200, lambda: 0.037 }, { d_mm: 25, lambda: 0 }]).U, ren);
});

test("Trappe 2800 mm giver 16 stigninger á 175 mm", () => {
  const r = stairs(2800);
  assert.equal(r.antalStigninger, 16);
  assert.equal(r.stigning_mm, 175);
  assert.equal(r.grund_mm, 270);
  assert.equal(r.antalTrin, 15);
});

test("Trappe advarer i fælles adgangsvej over 180 mm", () => {
  const r = stairs(2800, { maalStigning: 200, faellesAdgangsvej: true });
  assert.ok(r.stigning_mm > 180);
  assert.ok(r.warnings.some((w) => w.includes("§ 57")));
});

test("Væg og tag giver fornuftige mængder", () => {
  const w = wallMaterials({ laengde_m: 4, hoejde_m: 2.5, cc_mm: 600, sider: 2, lagPlader: 2, pladeB_m: 0.9, pladeH_m: 2.4, spild_pct: 0 });
  assert.equal(w.stolper, 8); // 4000/600 = 6,67 → 7 + 1
  assert.equal(w.plader, Math.ceil((10 * 4) / 2.16)); // 19
  const t = roof({ laengde_m: 10, bredde_m: 8, haeldning_grader: 45, udhaeng_m: 0, spild_pct: 0 });
  assert.ok(Math.abs(t.tagflade_m2 - 2 * (4 / Math.cos(Math.PI / 4)) * 10) < 0.1);
  assert.equal(t.rygHoejde_m, 4);
});

test("Dagslys og ventilation", () => {
  assert.equal(daylight(16, 1.6).ok, true);
  assert.equal(daylight(16, 1.4).mangler_m2, 0.2);
  const v = ventilation({ areal_m2: 100, koekkener: 1, badWc: 1, wcUdenBad: 1, bryggers: 1 });
  assert.equal(v.grundluftskifte_ls, 30);
  assert.equal(v.forceretUdsugning_ls, 55);
});

test("Søgning finder BR18-viden om værn og paragraffer", () => {
  const idx = buildIndex(SEED.map((s, i) => ({ id: i, title: s.title, text: s.title + " " + s.text })));
  assert.match(search(idx, "hvor højt skal et værn ved altan være", 1)[0].title, /værn/i);
  assert.match(search(idx, "u-værdi ydervæg tilbygning", 1)[0].title, /tilbygning/);
  assert.ok(tokenize("§ 257").includes("par257"));
  assert.match(search(idx, "§ 379", 1)[0].title, /dagslys/i);
});

test("Rettelser vægtes højere end startviden", () => {
  const idx = buildIndex([{ id: "a", text: "trapper stigning krav bolig", boost: 1 }, { id: "b", text: "trapper stigning krav bolig", boost: 1.8 }]);
  assert.equal(search(idx, "trapper stigning", 1)[0].id, "b");
});

test("Opdeling i stykker dækker hele teksten", () => {
  const t = Array.from({ length: 300 }, (_, i) => `Sætning ${i}.`).join(" ");
  const c = chunk(t, 500, 100);
  assert.ok(c.length > 3 && c.every((x) => x.length <= 500) && c.at(-1).includes("Sætning 299"));
});

test("Markdown escaper HTML (ingen XSS fra modellen)", () => {
  const h = md('<img src=x onerror=alert(1)> **fed** [link](javascript:alert(1))\n```\n<script>x</script>\n```');
  assert.ok(!h.includes("<img") && !h.includes("<script>") && !h.includes('href="javascript'));
  assert.ok(h.includes("<strong>fed</strong>") && h.includes("&lt;script&gt;"));
  assert.equal(esc(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("Filforslag fra AI parses", () => {
  const txt = "Her er siden:\n### FILE: index.html\n```html\n<h1>Hej</h1>\n```\nOg css\nFILE: css/style.css\n```css\nh1{color:red}\n```";
  const f = parseFileBlocks(txt);
  assert.deepEqual(f.map((x) => x.path), ["index.html", "css/style.css"]);
  assert.equal(f[0].content, "<h1>Hej</h1>\n");
});

test("Forhåndsvisning indlejrer lokal css og js", () => {
  const out = buildPreview({ "index.html": '<link rel="stylesheet" href="style.css"><script src="app.js"></script>', "style.css": "body{}", "app.js": "x()" });
  assert.ok(out.includes("<style>\nbody{}") && out.includes("x()") && !out.includes('src="app.js"'));
});

test("Handlinger i svar parses og fjernes fra visningen", () => {
  const t = 'Jeg opretter den.\n```json\n{"tool": "task_create", "title": "Bestil spær", "due": "2026-12-01T09:00"}\n```';
  assert.equal(parseActions(t)[0].title, "Bestil spær");
  assert.equal(stripActions(t), "Jeg opretter den.");
});

test("Kontekst indeholder relevant viden og opgaver", () => {
  state.knowledge = SEED.map((s, i) => ({ ...s, id: "s" + i, kind: "seed" }));
  state.tasks = [{ id: "t", title: "Ring til kunden", done: false }];
  const { messages, sources } = buildContext("konstruktor", "Hvad er kravet til dagslys i et soveværelse?", []);
  assert.ok(sources.some((s) => /dagslys/i.test(s.title)));
  assert.ok(messages[0].content.includes("Ring til kunden"));
});

// ---------------- CAD ----------------
import { demoHouse, validateModel, plan2d, mesh3d, toDXF, toDXF3D, toOBJ, toIFC, wallGeom, bounds } from "../cad.js";

test("CAD: demohus er gyldigt og har forventede mål", () => {
  const m = demoHouse();
  const v = validateModel(m);
  assert.ok(v.ok, v.errors.join("; "));
  const b = bounds(m);
  assert.equal(b.w, 10000); assert.equal(b.d, 8000);
});

test("CAD: åbning uden for væg fanges", () => {
  const m = { wallHeight: 2600, walls: [{ x1: 0, y1: 0, x2: 2000, y2: 0, thickness: 300, type: "ext", openings: [{ pos: 1800, width: 1000, height: 2100, type: "door" }] }] };
  assert.equal(validateModel(m).ok, false);
});

test("CAD: vægfaces ligger præcist i halv vægtykkelse", () => {
  // Enkelt vandret ydervæg, t=300 → faces i y=±150
  const m = { wallHeight: 2600, walls: [{ x1: 0, y1: 0, x2: 5000, y2: 0, thickness: 300, type: "ext", openings: [] }] };
  const L = plan2d(m);
  const ys = new Set(L.walls.flatMap((s) => s.map((p) => p[1])));
  assert.ok(ys.has(150) && ys.has(-150));
});

test("CAD: åbning laver hul i plan (fire vægsegmenter langs en væg med ét vindue)", () => {
  const m = { wallHeight: 2600, walls: [{ x1: 0, y1: 0, x2: 4000, y2: 0, thickness: 200, type: "ext", openings: [{ pos: 2000, width: 1000, height: 1300, sill: 900, type: "window" }] }] };
  const L = plan2d(m);
  // Pr. side: segment før (0–1500) og efter (2500–4000) = 2 segmenter × 2 sider = 4 lange segmenter
  const horiz = L.walls.filter((s) => Math.abs(s[0][1]) === 100 && Math.abs(s[1][1]) === 100 && s[0][0] !== s[1][0]);
  assert.equal(horiz.length, 4);
  // Vinduet efterlader et gab mellem x=1500 og x=2500
  assert.ok(horiz.some((s) => Math.min(s[0][0], s[1][0]) === 0 && Math.max(s[0][0], s[1][0]) === 1500));
  assert.ok(horiz.some((s) => Math.min(s[0][0], s[1][0]) === 2500 && Math.max(s[0][0], s[1][0]) === 4000));
});

test("CAD: DXF er velformet og har lag + entiteter", () => {
  const dxf = toDXF(demoHouse());
  assert.ok(dxf.startsWith("0\nSECTION"));
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.ok(dxf.includes("\nLAYER\n") && dxf.includes("\nWALL\n"));
  assert.ok((dxf.match(/\nLINE\n/g) || []).length > 20);
  assert.ok(dxf.includes("\nTEXT\n") && dxf.includes("Stue"));
  // Lige mange SECTION/ENDSEC
  assert.equal((dxf.match(/\nSECTION\n/g) || []).length, (dxf.match(/\nENDSEC\n/g) || []).length);
});

test("CAD: 3D-DXF har 3DFACE og OBJ har vertices/faces", () => {
  const m = demoHouse();
  const dxf3 = toDXF3D(m);
  assert.ok((dxf3.match(/\n3DFACE\n/g) || []).length > 10);
  const obj = toOBJ(m);
  assert.ok((obj.match(/\nv /g) || []).length > 20);
  assert.ok((obj.match(/\nf /g) || []).length > 10);
  assert.ok(obj.includes("g wall") && obj.includes("g roof"));
});

test("CAD: mesh har lukkede quads og tag over væghøjde", () => {
  const m = demoHouse();
  const { vertices, faces, groups } = mesh3d(m);
  assert.ok(faces.every((f) => f.v.every((i) => i >= 0 && i < vertices.length)));
  assert.ok(groups.roof?.length >= 2);
  const maxZ = Math.max(...vertices.map((v) => v[2]));
  assert.ok(maxZ > m.wallHeight); // gavl rejser sig over væggen
});

test("CAD: IFC4 er struktur-gyldigt (balanceret, har kerne-entiteter)", () => {
  const ifc = toIFC(demoHouse(), { name: "Testhus" });
  assert.ok(ifc.startsWith("ISO-10303-21;") && ifc.trimEnd().endsWith("END-ISO-10303-21;"));
  assert.ok(ifc.includes("FILE_SCHEMA(('IFC4'))"));
  for (const t of ["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCWALL", "IFCSLAB", "IFCEXTRUDEDAREASOLID", "IFCRELCONTAINEDINSPATIALSTRUCTURE"])
    assert.ok(ifc.includes(t), "mangler " + t);
  // Alle #ref peger på en defineret linje
  const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const used = new Set([...ifc.matchAll(/#(\d+)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !defined.has(id));
  assert.deepEqual(missing, [], "udefinerede referencer: " + missing.slice(0, 5));
  // Hver datalinje slutter med ;
  assert.ok(ifc.split("\nDATA;\n")[1].split("\n").filter((l) => l.startsWith("#")).every((l) => l.endsWith(";")));
});

// ---------------- Modelvalg (crash-sikring) ----------------
import { recommendedModel, smallerModel } from "../core.js";
const CAT = [
  { id: "Qwen2.5-0.5B", kind: "chat", vram: 950 },
  { id: "Qwen2.5-1.5B", kind: "chat", vram: 1300 },
  { id: "gemma-2-2b", kind: "chat", vram: 1900 },
  { id: "Qwen2.5-3B", kind: "chat", vram: 2500 },
  { id: "Qwen2.5-7B", kind: "chat", vram: 5500 },
  { id: "Qwen2.5-Coder-3B", kind: "code", vram: 2400 },
];
test("Model: lille budget (mobil) vælger lille model, aldrig den tunge", () => {
  assert.equal(recommendedModel(CAT, "chat", { maxVram: 1500 }), "Qwen2.5-1.5B");
  assert.equal(recommendedModel(CAT, "chat", { maxVram: 1000 }), "Qwen2.5-0.5B");
  assert.equal(recommendedModel(CAT, "chat", { maxVram: 6000 }), "Qwen2.5-7B");
  // under alle modeller → mindste tilgængelige, aldrig tom/crash
  assert.equal(recommendedModel(CAT, "chat", { maxVram: 100 }), "Qwen2.5-0.5B");
});
test("Model: nedgradering efter crash vælger næste mindre", () => {
  assert.equal(smallerModel(CAT, "Qwen2.5-3B"), "gemma-2-2b");
  assert.equal(smallerModel(CAT, "gemma-2-2b"), "Qwen2.5-1.5B");
  assert.equal(smallerModel(CAT, "Qwen2.5-0.5B"), "Qwen2.5-0.5B"); // floor
});
