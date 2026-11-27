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
