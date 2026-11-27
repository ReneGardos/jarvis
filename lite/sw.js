// Service worker: gør appen installérbar og brugbar offline. AI-modellerne caches af WebLLM/transformers selv.
const CACHE = "jarvis-lite-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "core.js", "build.js", "voice.js", "code.js", "cad.js", "cad-ui.js", "research.js", "calc.js", "search.js", "md.js", "knowledge/br18.js",
  "llm-worker.js", "asr-worker.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith("jarvis-lite")).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin) {
    // Netværk først (nye versioner), cache som fallback offline
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request)));
  } else if (/esm\.run|cdn\.jsdelivr\.net/.test(url.host)) {
    // Biblioteker fra CDN caches, så appen virker offline efter første besøg
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
  }
});
