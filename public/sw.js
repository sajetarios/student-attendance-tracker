
const CACHE = "school-attendance-shell-v14";

const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/responsive.css",
  "/comfort-ui.css",
  "/app-enhance.css?v=0.9.0",
  "/app-enhance.js?v=0.9.0",
  "/app.js",
  "/manifest.webmanifest",
  "/vendor/html5-qrcode.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache authenticated or API requests.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("Authorization")
  ) {
    return;
  }

  // Network first so a new deploy is picked up immediately; the cache is only the offline fallback.
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() =>
      caches.match(request).then(cached => cached || caches.match("/index.html"))
    )
  );
});
