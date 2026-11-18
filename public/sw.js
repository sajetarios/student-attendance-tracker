const CACHE = "attendigo-v230-memorable-student-ids";

const SHELL = [
  "/typography.css?v=1",
  "/attendigo-workspace-density-theme.css?v=1",
  "/fonts/InterVariable.woff2",
  "/fonts/InterVariable-Italic.woff2",
  "/attendigo-brand-refresh.css?v=3",
  "/assets/attendigo-favicon.png?v=2",
  "/assets/attendigo-apple-touch-icon.png?v=2",
  "/assets/attendigo-icon-192.png?v=2",
  "/assets/attendigo-icon-512.png?v=2",
  "/assets/attendigo-sidebar-logo.png?v=2",
  "/assets/attendigo-wordmark-on-dark.svg?v=2",
  "/assets/attendigo-wordmark-on-light.svg?v=2",
  "/assets/attendigo-symbol-transparent.svg?v=2",
  "/attendigo-sidebar-adaptive.css?v=19",
  "/user-management-readability.css?v=6",
  "/user-nav-reorg.css?v=1",
  "/attendigo-sidebar-adaptive.js?v=9",
  "/assets/attendigo-logo.png?v=2",
  "/assets/attendigo-icon.png?v=2",
  "/attendigo-brand.css?v=2",
  "/dashboard-icons.js?v=6",
  "/dashboard-ui.css?v=wide5",
  "/dashboard-night.css?v=1",
  "/planner.css?v=3",
  "/planner.js?v=5",
  "/attendigo-dark-unified.css?v=1",
  "/dashboard-polish.css?v=2",
  "/photo-editor.css?v=2",
  "/photo-editor.js?v=11",
  "/photo-editor.js?v=9",
  "/session-guard.js?v=4",
  "/flicker-diagnostics.js?v=1",
  "/school-header-responsive.js?v=2",
  "/student-portal-refinement.css?v=1",
  "/student-portal.js?v=20",
  "/parent-portal.js?v=3",
  "/dashboard-appearance.js?v=3",
  "/timetable-grid.js?v=4",
  "/schedule-workspace-ui.js?v=6",
  "/teacher-assignment-modal.css?v=1",
  "/portal-login.html",
  "/attendigo-login-motion.css?v=2",
  "/attendigo-login-refinement.css?v=5",
  "/portal.css?v=0.9.118",
  "/student-roster-toolbar.css?v=2",
  "/learner-roster-view.css?v=1",
  "/teacher-learner-roster.css?v=4",
  "/learner-roster-view.js?v=1",
  "/class-qr-dashboard-link.js?v=9",
  "/teacher-roster-popover.js?v=2",
  "/portal.css",
  "/portal.js?v=199",
  "/department-workspace.css?v=1",
  "/department-workspace.js?v=1",
  "/form48-report.js?v=7",
  "/form48-bulk-ui.js?v=2",
  "/form48-report.css?v=7",
  "/staff-lunch-ui.js?v=3",
  "/staff-ob-ui.js?v=5",
  "/staff-ob.css?v=1",
  "/staff-lunch.css?v=3",
  "/staff-lunch-checkin.js?v=3",
  "/sardo-monitor.js?v=2",
  "/sardo-monitor.css?v=1",
  "/schedule-form-layout.css?v=12",
  "/parent-dashboard.js?v=3",
  "/offline-attendance.js?v=5",
  "/offline-sheet.html",
  "/offline-sheet.js?v=4",
  "/manual-folio.css?v=11",
  "/attendance-sync-center.css?v=4",
  "/attendance-sync-center.js?v=3",
  "/manual-folio.js?v=18",
  "/student-portal-accounts.css?v=6",
  "/student-workspace-tabs.css?v=1",
  "/student-portal-accounts.js?v=11",
  "/account-directory.js?v=2",
  "/admin-request-notifications.js?v=5",
  "/admin-request-notifications.css?v=2",
  "/universal-notifications.js?v=2",
  "/universal-notifications.css?v=1",
  "/guardian-ui.js?v=6",
  "/guardian-ui.css?v=4",
  "/academic-admin.css?v=1",
  "/academic-admin.js?v=7",
  "/special-program-ui.js?v=6",
  "/special-program-batch-ui.js?v=3",
  "/special-program-ui.css?v=5",
  "/app-dialog.css?v=1",
  "/app-dialog.js?v=1",
  "/sw-refresh.js?v=3",
  "/smart-mobile-header.js?v=4",
  "/form-system.css?v=1",
  "/password-visibility.css",
  "/password-visibility.js",
  "/portal-login.js?v=14",
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

  // Never send, cache, or serve a document request with credentials in its URL.
  // This also protects people who still have a legacy cached login form.
  const isAccountPage = ['/', '/index.html', '/portal-login.html',
    '/parent-register.html', '/platform-setup.html',
    '/force-password-change.html', '/class-qr-checkin.html', '/attendance-pin.html', '/staff-lunch-checkin.html', '/portal.html',
    '/student-portal.html', '/parent-portal.html'].includes(url.pathname);
  const credentialKey = /^(?:password|passwd|pwd|pass|currentpassword|newpassword|confirmpassword|recoverycode|setupcode|accesstoken)$/i;
  if (isAccountPage && [...url.searchParams.keys()].some(key => credentialKey.test(key))) {
    event.respondWith(Response.redirect(new URL('/portal-login.html', url.origin).href, 303));
    return;
  }

  // Authenticated dashboards are never served from the offline shell cache.
  if (["/portal.html", "/student-portal.html", "/parent-portal.html",
       "/force-password-change.html", "/attendance-pin.html", "/class-qr-checkin.html", "/staff-lunch-checkin.html"].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Authentication scripts must never remain stale across releases or domain changes.
  // They need the deployed code online, with cached copies available only offline.
  if (['/portal-login.js', '/login-routing.js', '/student-portal.js'].includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (!fresh.ok) throw Error('Login asset could not be refreshed');
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Keep scheduling UI fresh without breaking offline school operation.
  // Unlike cache-first general assets, these role-critical resources prefer the deployed version.
  if (['/portal.js','/learner-roster-view.js','/learner-roster-view.css','/manual-folio.js','/manual-folio.css','/schedule-form-layout.css','/schedule-workspace-ui.js','/teacher-assignment-modal.css'].includes(url.pathname)) {
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
        if (response.ok && !url.search) {
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
