// Offline-Fähigkeit: App-Dateien zwischenspeichern. Bei Änderungen VERSION erhöhen.
const VERSION = 'diktat-v4';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'textproc.js', 'doc.js', 'speech.js', 'drive.js', 'ai.js', 'config.js', 'odt.js', 'ablage.js', 'vendor/fflate-0.8.2.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netz zuerst (immer aktuelle Version), bei fehlendem Netz aus dem Zwischenspeicher
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
