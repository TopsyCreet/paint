/* Colour Studio service worker: offline app shell + cached heavy assets.
   Bump VERSION when you need every device to drop its old caches. */
const VERSION = "v1";
const SHELL = `cs-shell-${VERSION}`;
const RUNTIME = `cs-runtime-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: network first so updates arrive; fall back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Catalogue data: network first, cached copy offline.
  if (url.origin === location.origin && url.pathname.includes("/data/")) {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
    return;
  }

  // Built assets, WASM, the AI model and fonts: cache first (they are versioned or immutable).
  const cacheable =
    (url.origin === location.origin && /\/(assets|vendor|icons)\//.test(url.pathname)) ||
    url.hostname === "storage.googleapis.com" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com";
  if (cacheable) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
