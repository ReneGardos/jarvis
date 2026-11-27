// CAD-motor: parametrisk bygningsmodel → præcis geometri → DXF (2D + 3D), IFC4 og OBJ.
// Alle mål i millimeter. Akseparallelle vægge (vandret/lodret), som dækker langt de fleste boligplaner.
// Rene funktioner uden afhængigheder, så geometrien kan testes eksakt (node --test).

export const r3 = (v) => Math.round(v * 1000) / 1000; // afrund til µm, undgå flydende-komma-støj

// ---------------- Modelhjælp ----------------
/** Normaliser en væg: returnér retning, længde og enhedsvektorer. */
export function wallGeom(w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) throw new Error("Væg har længde 0");
  const ux = dx / len, uy = dy / len;      // langs væggen
  const nx = -uy, ny = ux;                   // på tværs (venstre)
  return { len, ux, uy, nx, ny, dx, dy };
}

/** Punkt på vægcenterlinjen i afstand d fra start. */
export function along(w, d, g = wallGeom(w)) { return [w.x1 + g.ux * d, w.y1 + g.uy * d]; }

/** Giver et validerings-resultat: fejl og advarsler om modellen. */
export function validateModel(m) {
  const errors = [], warnings = [];
  if (!m.walls?.length) errors.push("Modellen har ingen vægge.");
  (m.walls || []).forEach((w, i) => {
    try {
      const g = wallGeom(w);
      const axis = Math.abs(g.ux) > 0.999 ? "x" : Math.abs(g.uy) > 0.999 ? "y" : null;
      if (!axis) warnings.push(`Væg ${i + 1} er ikke vandret/lodret – skråvægge understøttes ikke præcist endnu.`);
      for (const o of w.openings || []) {
        if (o.pos - o.width / 2 < -1 || o.pos + o.width / 2 > g.len + 1)
          errors.push(`Åbning i væg ${i + 1} ligger uden for væggen (pos ${o.pos}, bredde ${o.width}, væglængde ${Math.round(g.len)}).`);
        if ((o.sill || 0) + o.height > m.wallHeight + 1)
          warnings.push(`Åbning i væg ${i + 1} er højere end væggen.`);
      }
    } catch (e) { errors.push(`Væg ${i + 1}: ${e.message}`); }
  });
  return { ok: errors.length === 0, errors, warnings };
}

/** Bygningens bruttoareal (konveks/rektangulær bounding af ydervægge). */
export function bounds(m) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of m.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY };
}

// ---------------- 2D plangeometri ----------------
/** Bygger 2D-plan som lister af segmenter pr. lag. Vægge tegnes med dobbeltlinje og rigtige huller ved åbninger. */
export function plan2d(m) {
  const L = { walls: [], openings: [], doors: [], windows: [], dims: [], text: [] };
  for (const w of m.walls) {
    const g = wallGeom(w);
    const t = w.thickness || (w.type === "ext" ? 300 : 108);
    const h = t / 2;
    const offs = (s) => [[w.x1 + g.nx * s * h, w.y1 + g.ny * s * h], [w.x2 + g.nx * s * h, w.y2 + g.ny * s * h]];
    // Sorter åbninger langs væggen og byg intervaller af solid væg
    const ops = [...(w.openings || [])].sort((a, b) => a.pos - b.pos);
    for (const side of [1, -1]) {
      const [p0, p1] = offs(side);
      let cursor = 0;
      for (const o of ops) {
        const a = o.pos - o.width / 2, b = o.pos + o.width / 2;
        L.walls.push([along2(p0, p1, cursor / g.len), along2(p0, p1, a / g.len)]);
        cursor = b;
      }
      L.walls.push([along2(p0, p1, cursor / g.len), p1]);
    }
    // Endekapper
    L.walls.push(offs(1).map((p, i) => [p, offs(-1)[i]])[0]); // start-kap
    L.walls.push([offs(1)[1], offs(-1)[1]]); // slut-kap
    // Åbninger: karme + symbol
    for (const o of ops) {
      const c = along(w, o.pos, g);
      const a0 = along(w, o.pos - o.width / 2, g), a1 = along(w, o.pos + o.width / 2, g);
      // jambe-linjer (karm) på tværs
      L.openings.push([[a0[0] + g.nx * h, a0[1] + g.ny * h], [a0[0] - g.nx * h, a0[1] - g.ny * h]]);
      L.openings.push([[a1[0] + g.nx * h, a1[1] + g.ny * h], [a1[0] - g.nx * h, a1[1] - g.ny * h]]);
      if (o.type === "door") {
        const hinge = a0, open = o.width;
        L.doors.push([hinge, [hinge[0] + g.uy * open, hinge[1] - g.ux * open]]); // dørblad (90°)
        L.doors.push(arc(hinge, open, Math.atan2(-g.ux, g.uy), Math.atan2(g.uy, g.ux)));
      } else {
        // vindue: tre linjer i karmen
        for (const s of [0.5, 0, -0.5]) {
          L.windows.push([[a0[0] + g.nx * h * s * 1, a0[1] + g.ny * h * s], [a1[0] + g.nx * h * s, a1[1] + g.ny * h * s]]);
        }
      }
    }
  }
  // Mål (samlet bredde og dybde)
  const b = bounds(m);
  const off = 900;
  L.dims.push(dim([b.minX, b.minY - off], [b.maxX, b.minY - off], b.w, "h"));
  L.dims.push(dim([b.minX - off, b.minY], [b.minX - off, b.maxY], b.d, "v"));
  // Rumtekster
  for (const lb of m.labels || []) L.text.push({ x: lb.x, y: lb.y, text: lb.text, h: 200 });
  return L;
}

function along2(p0, p1, t) { return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; }
function arc(center, r, a0, a1, _s) {
  const pts = [], steps = 10;
  let d = a1 - a0; while (d < 0) d += Math.PI * 2; if (d > Math.PI) d -= Math.PI * 2;
  for (let i = 0; i <= steps; i++) { const a = a0 + (d * i) / steps; pts.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]); }
  return pts;
}
function dim(p0, p1, value, dir) {
  const txt = (value / 1000).toFixed(2).replace(".", ",") + " m";
  const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  return { p0, p1, txt, mid, dir };
}

// ---------------- 3D-geometri (mesh: vertices + faces) ----------------
/** Bygger en 3D-mesh af vægge (med huller), gulvplade og tag. Returnerer {vertices:[[x,y,z]], faces:[[i,j,k,...]], groups}. */
export function mesh3d(m) {
  const V = [], F = [], groups = {};
  const addV = (x, y, z) => { V.push([r3(x), r3(y), r3(z)]); return V.length - 1; };
  const quad = (a, b, c, d, g) => { F.push({ v: [a, b, c, d], g }); (groups[g] ||= []).push(F.length - 1); };

  for (const w of m.walls) {
    const gg = wallGeom(w);
    const t = w.thickness || (w.type === "ext" ? 300 : 108);
    const h = t / 2, H = m.wallHeight;
    const ops = [...(w.openings || [])].sort((a, b) => a.pos - b.pos);
    for (const side of [1, -1]) {
      const sx = gg.nx * h * side, sy = gg.ny * h * side;
      // Byg facen som lodrette paneler mellem åbninger, og over/under hver åbning
      let cursor = 0;
      const panel = (d0, d1, z0, z1) => {
        const [x0, y0] = along(w, d0, gg), [x1, y1] = along(w, d1, gg);
        const a = addV(x0 + sx, y0 + sy, z0), b = addV(x1 + sx, y1 + sy, z0), c = addV(x1 + sx, y1 + sy, z1), e = addV(x0 + sx, y0 + sy, z1);
        quad(a, b, c, e, "wall");
      };
      for (const o of ops) {
        const a = o.pos - o.width / 2, b = o.pos + o.width / 2, sill = o.sill || 0, top = sill + o.height;
        if (a > cursor) panel(cursor, a, 0, H);         // fuld væg før åbning
        if (sill > 0) panel(a, b, 0, sill);              // brystning under vindue
        if (top < H) panel(a, b, top, H);                // over åbning
        cursor = b;
      }
      if (cursor < gg.len) panel(cursor, gg.len, 0, H);
    }
    // top og bund af væggen + endekapper (forenklet: lukkede ender)
    const capEnds = [[0, 1], [gg.len, 1]];
    for (const [d, _] of capEnds) {
      const [x, y] = along(w, d, gg);
      const a = addV(x + gg.nx * h, y + gg.ny * h, 0), b = addV(x - gg.nx * h, y - gg.ny * h, 0),
        c = addV(x - gg.nx * h, y - gg.ny * h, H), e = addV(x + gg.nx * h, y + gg.ny * h, H);
      quad(a, b, c, e, "wall");
    }
  }
  const b = bounds(m);
  if (m.slab !== false) {
    const z = 0;
    const a = addV(b.minX, b.minY, z), bb = addV(b.maxX, b.minY, z), c = addV(b.maxX, b.maxY, z), d = addV(b.minX, b.maxY, z);
    quad(a, bb, c, d, "slab");
  }
  addRoof(m, b, addV, quad);
  return { vertices: V, faces: F, groups, bounds: b };
}

function addRoof(m, b, addV, quad) {
  const roof = m.roof || { type: "flat" };
  const oh = roof.overhang ?? 400;
  const x0 = b.minX - oh, x1 = b.maxX + oh, y0 = b.minY - oh, y1 = b.maxY + oh, base = m.wallHeight;
  if (roof.type === "flat") {
    const a = addV(x0, y0, base), bb = addV(x1, y0, base), c = addV(x1, y1, base), d = addV(x0, y1, base);
    quad(a, bb, c, d, "roof"); return;
  }
  const pitch = (roof.pitch ?? 30) * Math.PI / 180;
  if (roof.ridgeAxis === "x" || (!roof.ridgeAxis && b.w >= b.d)) {
    const ridgeH = base + Math.tan(pitch) * (b.d / 2 + oh);
    const yc = (y0 + y1) / 2;
    const rA = addV(x0, yc, ridgeH), rB = addV(x1, yc, ridgeH);
    quad(addV(x0, y0, base), addV(x1, y0, base), rB, rA, "roof");
    quad(addV(x0, y1, base), addV(x1, y1, base), rB, rA, "roof");
  } else {
    const ridgeH = base + Math.tan(pitch) * (b.w / 2 + oh);
    const xc = (x0 + x1) / 2;
    const rA = addV(xc, y0, ridgeH), rB = addV(xc, y1, ridgeH);
    quad(addV(x0, y0, base), addV(x0, y1, base), rB, rA, "roof");
    quad(addV(x1, y0, base), addV(x1, y1, base), rB, rA, "roof");
  }
}

// ---------------- DXF (AutoCAD R12 ASCII – importeres af AutoCAD, Revit, BricsCAD, LibreCAD) ----------------
const LAYERS = { walls: ["WALL", 7], openings: ["OPENING", 3], doors: ["DOOR", 5], windows: ["WINDOW", 4], dims: ["DIM", 1], text: ["TEXT", 2], slab: ["SLAB", 8], roof: ["ROOF", 6] };

function dxfHeader() {
  const tbl = Object.values(LAYERS).map(([name, col]) =>
    `0\nLAYER\n2\n${name}\n70\n0\n62\n${col}\n6\nCONTINUOUS`).join("\n");
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n` +
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${Object.keys(LAYERS).length}\n${tbl}\n0\nENDTAB\n0\nENDSEC\n` +
    `0\nSECTION\n2\nENTITIES\n`;
}
const dxfLine = (p0, p1, layer) => `0\nLINE\n8\n${layer}\n10\n${r3(p0[0])}\n20\n${r3(p0[1])}\n30\n0\n11\n${r3(p1[0])}\n21\n${r3(p1[1])}\n31\n0\n`;
const dxfPoly = (pts, layer, closed = 0) => `0\nLWPOLYLINE\n8\n${layer}\n90\n${pts.length}\n70\n${closed}\n` + pts.map((p) => `10\n${r3(p[0])}\n20\n${r3(p[1])}\n`).join("");
const dxfText = (x, y, h, s, layer) => `0\nTEXT\n8\n${layer}\n10\n${r3(x)}\n20\n${r3(y)}\n40\n${h}\n1\n${String(s).replace(/\n/g, " ")}\n`;

/** 2D-plantegning som DXF. */
export function toDXF(m) {
  const L = plan2d(m);
  let s = dxfHeader();
  for (const seg of L.walls) s += dxfLine(seg[0], seg[1], LAYERS.walls[0]);
  for (const seg of L.openings) s += dxfLine(seg[0], seg[1], LAYERS.openings[0]);
  for (const seg of L.doors) s += seg.length > 2 ? dxfPoly(seg, LAYERS.doors[0]) : dxfLine(seg[0], seg[1], LAYERS.doors[0]);
  for (const seg of L.windows) s += dxfLine(seg[0], seg[1], LAYERS.windows[0]);
  for (const d of L.dims) {
    s += dxfLine(d.p0, d.p1, LAYERS.dims[0]);
    s += dxfText(d.mid[0] + (d.dir === "v" ? -250 : 0), d.mid[1] + (d.dir === "h" ? 120 : 0), 180, d.txt, LAYERS.dims[0]);
  }
  for (const t of L.text) s += dxfText(t.x, t.y, t.h, t.text, LAYERS.text[0]);
  return s + "0\nENDSEC\n0\nEOF\n";
}

/** 3D-model som DXF med 3DFACE (triangulerede quads). */
export function toDXF3D(m) {
  const { vertices: V, faces: F } = mesh3d(m);
  let s = dxfHeader();
  for (const f of F) {
    const layer = (LAYERS[f.g] || LAYERS.walls)[0];
    const p = f.v.map((i) => V[i]);
    const quad = p.length === 4 ? p : [p[0], p[1], p[2], p[2]];
    s += `0\n3DFACE\n8\n${layer}\n` + quad.map((pt, i) => `${10 + i}\n${pt[0]}\n${20 + i}\n${pt[1]}\n${30 + i}\n${pt[2]}\n`).join("");
  }
  return s + "0\nENDSEC\n0\nEOF\n";
}

// ---------------- OBJ (generisk 3D – Blender, SketchUp, de fleste viewere) ----------------
export function toOBJ(m) {
  const { vertices: V, faces: F } = mesh3d(m);
  let s = "# Jarvis CAD – mål i meter\n";
  for (const [x, y, z] of V) s += `v ${r3(x / 1000)} ${r3(z / 1000)} ${r3(-y / 1000)}\n`; // Y op, højrehåndet
  let g = "";
  for (const f of F) {
    if (f.g !== g) { g = f.g; s += `g ${g}\n`; }
    s += "f " + f.v.map((i) => i + 1).join(" ") + "\n";
  }
  return s;
}

// ---------------- IFC4 (BIM – BricsCAD BIM, Revit, ArchiCAD, Solibri) ----------------
let _id;
const ref = (n) => `#${n}`;
function ifcLine(lines, type, args) { const id = _id++; lines.push(`#${id}=${type}(${args});`); return id; }

/** Minimal men gyldig IFC4 med projekt, site, bygning, etage, vægge (med åbninger), plade og tag. */
export function toIFC(m, meta = {}) {
  _id = 1;
  const lines = [];
  const now = new Date();
  const g = (x, y, z = 0) => ifcLine(lines, "IFCCARTESIANPOINT", `(${r3(x / 1000)},${r3(y / 1000)},${r3(z / 1000)})`);
  const dir = (x, y, z) => ifcLine(lines, "IFCDIRECTION", `(${x},${y},${z})`);
  const origin = g(0, 0, 0);
  const zAx = dir(0, 0, 1), xAx = dir(1, 0, 0);
  const place = (p = origin) => ifcLine(lines, "IFCAXIS2PLACEMENT3D", `${ref(p)},${ref(zAx)},${ref(xAx)}`);
  const worldPlace = ifcLine(lines, "IFCLOCALPLACEMENT", `$,${ref(place())}`);

  const person = ifcLine(lines, "IFCPERSON", "$,'Bruger',$,$,$,$,$,$");
  const org = ifcLine(lines, "IFCORGANIZATION", "$,'Jarvis',$,$,$");
  const pando = ifcLine(lines, "IFCPERSONANDORGANIZATION", `${ref(person)},${ref(org)},$`);
  const app = ifcLine(lines, "IFCAPPLICATION", `${ref(org)},'1.0','Jarvis Lite CAD','JARVIS'`);
  const ts = Math.floor(now.getTime() / 1000);
  const owner = ifcLine(lines, "IFCOWNERHISTORY", `${ref(pando)},${ref(app)},$,.ADDED.,${ts},${ref(pando)},${ref(app)},${ts}`);

  const dimExp = ifcLine(lines, "IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.");
  const areaU = ifcLine(lines, "IFCSIUNIT", "*,.AREAUNIT.,$,.SQUARE_METRE.");
  const volU = ifcLine(lines, "IFCSIUNIT", "*,.VOLUMEUNIT.,$,.CUBIC_METRE.");
  const angU = ifcLine(lines, "IFCSIUNIT", "*,.PLANEANGLEUNIT.,$,.RADIAN.");
  const units = ifcLine(lines, "IFCUNITASSIGNMENT", `(${ref(dimExp)},${ref(areaU)},${ref(volU)},${ref(angU)})`);
  const ctx = ifcLine(lines, "IFCGEOMETRICREPRESENTATIONCONTEXT", `$,'Model',3,1.E-05,${ref(place())},$`);
  const gid = () => "'" + Array.from({ length: 22 }, () => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"[Math.floor(Math.random() * 64)]).join("") + "'";

  const proj = ifcLine(lines, "IFCPROJECT", `${gid()},${ref(owner)},'${meta.name || "Jarvis-projekt"}',$,$,$,$,(${ref(ctx)}),${ref(units)}`);
  const site = ifcLine(lines, "IFCSITE", `${gid()},${ref(owner)},'Site',$,$,${ref(worldPlace)},$,$,.ELEMENT.,$,$,$,$,$`);
  const bldg = ifcLine(lines, "IFCBUILDING", `${gid()},${ref(owner)},'${meta.name || "Bygning"}',$,$,${ref(worldPlace)},$,$,.ELEMENT.,$,$,$`);
  const storeyPlace = ifcLine(lines, "IFCLOCALPLACEMENT", `${ref(worldPlace)},${ref(place())}`);
  const storey = ifcLine(lines, "IFCBUILDINGSTOREY", `${gid()},${ref(owner)},'Stueplan',$,$,${ref(storeyPlace)},$,$,.ELEMENT.,0.`);

  ifcLine(lines, "IFCRELAGGREGATES", `${gid()},${ref(owner)},$,$,${ref(proj)},(${ref(site)})`);
  ifcLine(lines, "IFCRELAGGREGATES", `${gid()},${ref(owner)},$,$,${ref(site)},(${ref(bldg)})`);
  ifcLine(lines, "IFCRELAGGREGATES", `${gid()},${ref(owner)},$,$,${ref(bldg)},(${ref(storey)})`);

  const products = [];
  // Vægge som ekstruderede rektangler
  for (const w of m.walls) {
    const gg = wallGeom(w);
    const t = (w.thickness || (w.type === "ext" ? 300 : 108)) / 1000;
    const len = gg.len / 1000, H = m.wallHeight / 1000;
    const ang = Math.atan2(gg.uy, gg.ux);
    const lp = g(w.x1, w.y1, 0);
    const d2 = ifcLine(lines, "IFCDIRECTION", `(${r3(Math.cos(ang))},${r3(Math.sin(ang))})`);
    const ax2 = ifcLine(lines, "IFCAXIS2PLACEMENT2D", `${ref(g(0, 0))},${ref(d2)}`);
    // Profil langs x, centreret på tværs
    const prof = ifcLine(lines, "IFCRECTANGLEPROFILEDEF", `.AREA.,$,${ref(ifcLine(lines, "IFCAXIS2PLACEMENT2D", `${ref(g(len * 500, 0))},${ref(ifcLine(lines, "IFCDIRECTION", "(1.,0.)"))}`))},${r3(len)},${r3(t)}`);
    const wp = ifcLine(lines, "IFCLOCALPLACEMENT", `${ref(storeyPlace)},${ref(ifcLine(lines, "IFCAXIS2PLACEMENT3D", `${ref(lp)},${ref(zAx)},${ref(ifcLine(lines, "IFCDIRECTION", `(${r3(gg.ux)},${r3(gg.uy)},0.)`))}`))}`);
    const solid = ifcLine(lines, "IFCEXTRUDEDAREASOLID", `${ref(prof)},${ref(place())},${ref(zAx)},${r3(H)}`);
    const shape = ifcLine(lines, "IFCSHAPEREPRESENTATION", `${ref(ctx)},'Body','SweptSolid',(${ref(solid)})`);
    const pds = ifcLine(lines, "IFCPRODUCTDEFINITIONSHAPE", `$,$,(${ref(shape)})`);
    const wall = ifcLine(lines, "IFCWALL", `${gid()},${ref(owner)},'${w.type === "ext" ? "Ydervæg" : "Indervæg"}',$,$,${ref(wp)},${ref(pds)},$,.${w.type === "ext" ? "SOLIDWALL" : "PARTITIONING"}.`);
    products.push(wall);
  }
  // Etageplade
  const b = bounds(m);
  if (m.slab !== false) {
    const sprof = ifcLine(lines, "IFCRECTANGLEPROFILEDEF", `.AREA.,$,${ref(ifcLine(lines, "IFCAXIS2PLACEMENT2D", `${ref(g((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2))},${ref(ifcLine(lines, "IFCDIRECTION", "(1.,0.)"))}`))},${r3(b.w / 1000)},${r3(b.d / 1000)}`);
    const ssolid = ifcLine(lines, "IFCEXTRUDEDAREASOLID", `${ref(sprof)},${ref(place())},${ref(zAx)},0.1`);
    const sshape = ifcLine(lines, "IFCSHAPEREPRESENTATION", `${ref(ctx)},'Body','SweptSolid',(${ref(ssolid)})`);
    const spds = ifcLine(lines, "IFCPRODUCTDEFINITIONSHAPE", `$,$,(${ref(sshape)})`);
    const splace = ifcLine(lines, "IFCLOCALPLACEMENT", `${ref(storeyPlace)},${ref(place(g(0, 0, -100)))}`);
    products.push(ifcLine(lines, "IFCSLAB", `${gid()},${ref(owner)},'Terrændæk',$,$,${ref(splace)},${ref(spds)},$,.FLOOR.`));
  }
  ifcLine(lines, "IFCRELCONTAINEDINSPATIALSTRUCTURE", `${gid()},${ref(owner)},$,$,(${products.map(ref).join(",")}),${ref(storey)}`);

  const header = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\n` +
    `FILE_NAME('${(meta.name || "model").replace(/'/g, "")}.ifc','${now.toISOString()}',(''),(''),'Jarvis Lite','Jarvis CAD','');\n` +
    `FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n`;
  return header + lines.join("\n") + "\nENDSEC;\nEND-ISO-10303-21;\n";
}

// ---------------- Eksempelmodeller ----------------
export function demoHouse() {
  const W = 10000, D = 8000, t = 300, ti = 108, H = 2600;
  return {
    units: "mm", wallHeight: H,
    walls: [
      { x1: 0, y1: 0, x2: W, y2: 0, thickness: t, type: "ext", openings: [{ pos: 2000, width: 1200, height: 1300, sill: 900, type: "window" }, { pos: 5000, width: 1000, height: 2100, sill: 0, type: "door" }, { pos: 8000, width: 1200, height: 1300, sill: 900, type: "window" }] },
      { x1: W, y1: 0, x2: W, y2: D, thickness: t, type: "ext", openings: [{ pos: 4000, width: 1500, height: 1300, sill: 900, type: "window" }] },
      { x1: W, y1: D, x2: 0, y2: D, thickness: t, type: "ext", openings: [{ pos: 3000, width: 1200, height: 1300, sill: 900, type: "window" }] },
      { x1: 0, y1: D, x2: 0, y2: 0, thickness: t, type: "ext", openings: [] },
      { x1: 4000, y1: 0, x2: 4000, y2: 5000, thickness: ti, type: "int", openings: [{ pos: 3500, width: 900, height: 2100, sill: 0, type: "door" }] },
      { x1: 4000, y1: 5000, x2: W, y2: 5000, thickness: ti, type: "int", openings: [{ pos: 2500, width: 900, height: 2100, sill: 0, type: "door" }] },
    ],
    roof: { type: "gable", pitch: 35, overhang: 500 }, slab: true,
    labels: [{ x: 2000, y: 2500, text: "Stue" }, { x: 7000, y: 2500, text: "Vaerelse" }, { x: 7000, y: 6500, text: "Koekken" }, { x: 2000, y: 6500, text: "Bad" }],
  };
}
