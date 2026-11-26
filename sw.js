const CACHE = "ep-office-v593";
const SHELL = ["./index.html", "./geo.js", "./app.js", "./programs.js", "./fundraising.js", "./modules.js", "./collab.js", "./accounts.js", "./forms.js", "./policy.js", "./i18n.js", "./programmes-v2.js", "./styles.css", "./manifest.json", "./icon-192.png", "./logo.png", "./stamp.png", "./hero.jpg", "./letterhead.jpg"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
// Network first for the app itself, so a new deploy is picked up at once; cache is the offline fallback.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  const path = new URL(req.url).pathname;
  const isCode = req.mode === "navigate" || /\.(html|js|css|json)$/.test(path) || path === "/";
  if (isCode) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
