// Lokal fuldtekstsøgning (BM25) til vidensbasen og hukommelsen. Ingen afhængigheder.

const STOP = new Set(("og i at det en den til er som på de med han af for ikke der var mig sig men et har om vi min havde ham hun nu " +
  "over da fra du ud sin dem os op man hans hvor eller hvad skal selv her alle vil blev kunne ind når være dog noget ville jo deres " +
  "efter ned skulle denne end dette mit også under have dig anden hende mine alt meget sit sine vor mod disse hvis din nogle hos blive " +
  "mange ad bliver hendes været thi jer sådan kan må hvordan hvilke hvilken jeg the a an of to is in and or what how").split(" "));

export function tokenize(text) {
  return (text || "").toLowerCase().normalize("NFC")
    .replace(/§\s*(\d+)/g, " par$1 ") // "§ 257" → "par257", så paragraffer kan søges
    .replace(/(\d),(\d)/g, "$1.$2")
    .split(/[^a-zæøå0-9.]+/i)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// Let dansk stemming: fjern almindelige bøjningsendelser
const SUFFIXES = ["erne", "ene", "erne", "ende", "ede", "ers", "er", "en", "et", "es", "e", "s"];
export function stem(t) {
  if (/^\d/.test(t) || t.length < 5) return t;
  for (const s of SUFFIXES) if (t.endsWith(s) && t.length - s.length >= 3) return t.slice(0, -s.length);
  return t;
}

export function chunk(text, size = 900, overlap = 150) {
  const clean = (text || "").replace(/\r/g, "").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const win = clean.slice(start, end);
      const cut = Math.max(win.lastIndexOf("\n\n"), win.lastIndexOf(". "), win.lastIndexOf("\n"));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/** docs: [{id, text, boost?}] → index */
export function buildIndex(docs) {
  const N = docs.length;
  const df = new Map();
  const toks = docs.map((d) => {
    const t = tokenize(d.text);
    for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
    return t;
  });
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / Math.max(N, 1);
  return { docs, toks, df, N, avgdl };
}

export function search(index, query, k = 5, { k1 = 1.4, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !index.N) return [];
  const scores = index.toks.map((t, i) => {
    if (!t.length) return { i, s: 0 };
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = index.df.get(w) || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (t.length / index.avgdl)));
    }
    return { i, s: s * (index.docs[i].boost || 1) };
  });
  return scores.filter((x) => x.s > 0).sort((a, b2) => b2.s - a.s).slice(0, k).map((x) => ({ ...index.docs[x.i], score: x.s }));
}
