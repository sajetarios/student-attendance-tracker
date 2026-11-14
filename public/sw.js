const CACHE = "school-attendance-shell-v30-mobile-roster";

const SHELL = [
  "/portal-login.html",
  "/portal.css?v=0.9.15",
  "/portal.css",
  "/portal.js?v=0.9.18",
  "/academic-admin.css?v=1",
  "/academic-admin.js?v=2",
  "/app-dialog.css?v=1",
  "/app-dialog.js?v=1",
  "/sw-refresh.js?v=1",
  "/form-system.css?v=1",
  "/password-visibility.css",
  "/password-visibility.js",
  "/portal-login.js",
  "/login-routing.js",
  "/responsive.css?v=0.8.3",
  "/comfort-ui.css?v=0.8.5",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/vendor/html5-qrcode.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("Authorization")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const loginPage = await caches.match("/portal-login.html");
          if (loginPage) return loginPage;
        }
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
