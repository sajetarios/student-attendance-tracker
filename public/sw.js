const CACHE = "attendigo-v130-adviser-school-section-choices";

const SHELL = [
  "/assets/attendigo-sidebar-logo.png",
  "/attendigo-sidebar-adaptive.css?v=8",
  "/attendigo-sidebar-adaptive.js?v=3",
  "/assets/attendigo-logo.png",
  "/assets/attendigo-icon.png",
  "/attendigo-brand.css?v=2",
  "/dashboard-icons.js?v=4",
  "/dashboard-ui.css?v=wide5",
  "/dashboard-night.css?v=1",
  "/planner.css?v=2",
  "/planner.js?v=3",
  "/attendigo-dark-unified.css?v=1",
  "/dashboard-polish.css?v=2",
  "/photo-editor.css?v=2",
  "/photo-editor.js?v=9",
  "/session-guard.js?v=2",
  "/flicker-diagnostics.js?v=1",
  "/school-header-responsive.js?v=2",
  "/student-portal-refinement.css?v=1",
  "/student-portal.js?v=2",
  "/parent-portal.js?v=1",
  "/dashboard-appearance.js?v=3",
  "/timetable-grid.js?v=3",
  "/schedule-workspace-ui.js?v=5",
  "/portal-login.html",
  "/attendigo-login-motion.css?v=2",
  "/attendigo-login-refinement.css?v=2",
  "/portal.css?v=0.9.108",
  "/student-roster-toolbar.css?v=1",
  "/portal.css",
  "/portal.js?v=0.9.123",
  "/sardo-monitor.js?v=1",
  "/sardo-monitor.css?v=1",
  "/schedule-form-layout.css?v=11",
  "/parent-dashboard.js?v=2",
  "/offline-attendance.js?v=1",
  "/offline-sheet.html",
  "/offline-sheet.js?v=2",
  "/manual-folio.css?v=11",
  "/manual-folio.js?v=11",
  "/student-portal-accounts.css?v=2",
  "/student-portal-accounts.js?v=3",
  "/admin-request-notifications.js?v=2",
  "/admin-request-notifications.css?v=2",
  "/guardian-ui.js?v=4",
  "/guardian-ui.css?v=4",
  "/academic-admin.css?v=1",
  "/academic-admin.js?v=2",
  "/app-dialog.css?v=1",
  "/app-dialog.js?v=1",
  "/sw-refresh.js?v=3",
  "/smart-mobile-header.js?v=3",
  "/form-system.css?v=1",
  "/password-visibility.css",
  "/password-visibility.js",
  "/portal-login.js?v=6",
  "/login-routing.js",
  "/responsive.css?v=0.8.3",
  "/comfort-ui.css?v=0.8.8",
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

  // Authenticated dashboards are never served from the offline shell cache.
  if (["/portal.html", "/student-portal.html", "/parent-portal.html",
       "/force-password-change.html"].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Keep scheduling UI fresh without breaking offline school operation.
  // Unlike cache-first general assets, these role-critical resources prefer the deployed version.
  if (['/portal.js','/schedule-form-layout.css','/schedule-workspace-ui.js'].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (!fresh.ok) throw Error('Scheduling asset could not be refreshed');
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Never keep a stale profile-photo editor after a hotfix. The editor
  // changes upload formats and validation, so cached code can block uploads.
  if (url.pathname === "/photo-editor.js") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: "no-store" });
        if (fresh.ok) return fresh;
        throw Error("Photo editor fetch failed");
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })());
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
