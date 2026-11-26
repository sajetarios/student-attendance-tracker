const CACHE = "attendigo-v452-compact-weather-info";

// Only public, non-personal offline shells and their executable dependencies.
// An update must not discard the working cache before these are all ready.
const OFFLINE_TOOL_PAGES = ["/offline-sheet.html", "/gate-offline.html", "/student-qr-offline.html", "/offline-welcome.html"];
const OFFLINE_REQUIRED = [
  ...OFFLINE_TOOL_PAGES,
  "/attendigo-experience.css?v=4",
  "/attendigo-role-workspaces.js?v=5",
  "/attendigo-signature.css?v=9",
  "/school-weather-widget.js?v=4",
  "/attendigo-layout-density.css?v=1",
  "/app-dialog.css?v=2",
  "/app-dialog.js?v=1",
  "/typography.css?v=1",
  "/offline-account-guard.js?v=1",
  "/offline-attendance.js?v=5",
  "/offline-sheet.js?v=8",
  "/attendance-sync-center.js?v=3",
  "/attendance-sync-center.css?v=4",
  "/gate-offline.js?v=3",
  "/student-qr-offline.js?v=4",
  "/student-qr-offline-page.js?v=5",
  "/student-qr-scanner.js?v=6",
  "/student-qr-scanner.js?v=5",
  "/fonts/InterVariable.woff2",
  "/fonts/InterVariable-Italic.woff2",
  "/attendigo-brand.css?v=2",
  "/attendigo-brand-refresh.css?v=1",
  "/assets/attendigo-symbol-transparent.svg?v=5",
  "/assets/attendigo-favicon.png?v=2",
  "/assets/attendigo-apple-touch-icon.png?v=2",
  "/manifest.webmanifest",
  "/vendor/html5-qrcode.min.js",
  "/assets/attendigo-official-lockup.svg?v=5"
];

const SHELL = [
  "/attendigo-adaptive-palette.js?v=2",
  "/install.html",
  "/attendigo-install.js?v=5",
  "/attendigo-install-walkthrough.js?v=2",
  "/attendigo-install.css?v=6",
  "/typography.css?v=1",
  "/attendigo-form-overlap-guard.css?v=2",
  "/attendigo-workspace-density-theme.css?v=1",
  "/attendigo-unified-workspace.css?v=1",
  "/attendigo-unified-navigation.js?v=1",
  "/simplified-workspace.js?v=6",
  "/simplified-workspace.css?v=1",
  "/teacher-timetable-identities.css?v=2",
  "/schedule-relationships.js?v=2",
  "/fonts/InterVariable.woff2",
  "/fonts/InterVariable-Italic.woff2",
  "/attendigo-brand-refresh.css?v=5",
  "/assets/attendigo-favicon.png?v=3",
  "/assets/attendigo-apple-touch-icon.png?v=3",
  "/assets/attendigo-icon-192.png?v=3",
  "/assets/attendigo-icon-512.png?v=3",
  "/assets/attendigo-sidebar-logo.png?v=3",
  "/assets/attendigo-wordmark-on-dark.svg?v=5",
  "/assets/attendigo-wordmark-on-light.svg?v=5",
  "/assets/attendigo-symbol-transparent.svg?v=5",
  "/attendigo-sidebar-adaptive.css?v=20",
  "/user-management-readability.css?v=6",
  "/user-nav-reorg.css?v=1",
  "/attendigo-sidebar-adaptive.js?v=9",
  "/assets/attendigo-logo.png?v=3",
  "/assets/attendigo-icon.png?v=3",
  "/attendigo-brand.css?v=2",
  "/dashboard-icons.js?v=7",
  "/dashboard-ui.css?v=wide11",
  "/dashboard-night.css?v=1",
  "/planner.css?v=3",
  "/planner.js?v=5",
  "/attendigo-dark-unified.css?v=1",
  "/dashboard-polish.css?v=2",
  "/photo-editor.css?v=2",
  "/photo-editor.js?v=11",
  "/photo-editor.js?v=9",
  "/session-guard.js?v=6",
  "/flicker-diagnostics.js?v=1",
  "/school-header-responsive.js?v=2",
  "/student-portal-refinement.css?v=3",
  "/student-portal.js?v=28",
  "/student-qr-offline.js?v=4",
  "/student-qr-offline.html",
  "/student-qr-offline-page.js?v=5",
  "/vendor/html5-qrcode.min.js",
  "/session-guard.js?v=6",
  "/student-qr-scanner.js?v=6",
  "/parent-portal.js?v=6",
  "/parent-subject.js?v=1",
  "/parent-subject.css?v=1",
  "/parent-push.js?v=3",
  "/parent-push.css?v=3",
  "/parent-portal-refinement.css?v=1",
  "/dashboard-appearance.js?v=3",
  "/timetable-grid.js?v=8",
  "/schedule-workspace-ui.js?v=9",
  "/teacher-assignment-modal.css?v=1",
  "/portal-login.html",
  "/offline-welcome.html",
  "/attendigo-login-motion.css?v=2",
  "/attendigo-login-refinement.css?v=7",
  "/sf1-review-cards.css?v=2",
  "/portal.css?v=0.9.121",
  "/student-roster-toolbar.css?v=2",
  "/learner-roster-view.css?v=1",
  "/teacher-learner-roster.css?v=7",
  "/learner-roster-view.js?v=1",
  "/student-name-format.js?v=2",
  "/class-qr-dashboard-link.js?v=14",
  "/class-qr-monitor.js?v=2",
  "/class-qr-monitor-embedded.css?v=1",
  "/teacher-scanner-schedule.js?v=1",
  "/teacher-roster-popover.js?v=2",
  "/portal.css?v=0.9.119",
  "/portal.js?v=246",
  "/attendigo-help-topics.js?v=4",
  "/attendigo-help-guide.js?v=4",
  "/attendigo-help.css?v=4",
  "/staff-leave-ui.js?v=13",
  "/leave-approval-inbox.js?v=3",
  "/leave-approval-inbox.css?v=3",
  "/attendigo-presenter-nav.js?v=1",
  "/staff-leave-ui.css?v=8",
  "/leave-status-indicator.css?v=1",
  "/department-workspace.css?v=1",
  "/department-workspace.js?v=6",
  "/department-monitor-refresh.css?v=1",
  "/department-dashboard-v2.css?v=2",
  "/department-dashboard-v2.js?v=2",
  "/teacher-dashboard-v2.css?v=1",
  "/teacher-dashboard-v2.js?v=1",
  "/teacher-dashboard-v3.css?v=1",
  "/teacher-shortcuts-compact.css?v=1",
  "/teacher-teaching-overview.css?v=3",
  "/teacher-dashboard-v3.js?v=1",
  "/teacher-teaching-overview.js?v=4",
  "/form48-report.js?v=20",
  "/missing-scan-ui.js?v=8",
  "/missing-scan-ui.css?v=4",
  "/form48-intelligence.js?v=4",
  "/form48-bulk-ui.js?v=4",
  "/form48-report.css?v=19",
  "/smart-attendance-overview.css?v=5",
  "/role-controls-responsive.css?v=2",
  "/smart-attendance-overview.js?v=5",
  "/my-gate-insights.css?v=4",
  "/staff-lunch-ui.js?v=10",
  "/staff-precise-location.js?v=1",
  "/staff-department-location.js?v=8",
  "/staff-ob-ui.js?v=9",
  "/locator-slip-ui.js?v=5",
  "/staff-ob.css?v=1",
  "/staff-lunch.css?v=8",
  "/staff-lunch-checkin.js?v=5",
  "/sardo-monitor.js?v=2",
  "/sardo-monitor.css?v=1",
  "/schedule-form-layout.css?v=15",
  "/parent-dashboard.js?v=4",
  "/offline-attendance.js?v=5",
  "/offline-sheet.html",
  "/gate-offline.html",
  "/gate-offline.js?v=3",
  "/gate-offline-review.html",
  "/gate-offline-review.css?v=1",
  "/gate-offline-review.js?v=1",
  "/offline-sheet.js?v=8",
  "/manual-folio.css?v=11",
  "/class-attendance-mobile.css?v=1",
  "/recent-class-attendance.css?v=2",
  "/attendance-sync-center.css?v=4",
  "/attendance-sync-center.js?v=3",
  "/manual-folio.js?v=19",
  "/student-portal-accounts.css?v=6",
  "/student-workspace-tabs.css?v=1",
  "/student-portal-accounts.js?v=11",
  "/account-directory.js?v=2",
  "/admin-request-notifications.js?v=7",
  "/admin-request-notifications.css?v=2",
  "/admin-approval-navigation.css?v=1",
  "/universal-notifications.js?v=12",
  "/universal-notifications.css?v=4",
  "/guardian-ui.js?v=7",
  "/guardian-ui.css?v=4",
  "/academic-admin.css?v=1",
  "/academic-admin.js?v=8",
  "/shs-school-ui.js?v=2",
  "/shs-school-ui.css?v=2",
  "/special-program-ui.js?v=7",
  "/special-program-batch-ui.js?v=3",
  "/special-program-ui.css?v=5",
  "/app-dialog.css?v=2",
  "/app-dialog.js?v=1",
  "/sw-refresh.js?v=3",
  "/smart-mobile-header.js?v=4",
  "/form-system.css?v=1",
  "/password-visibility.css",
  "/password-visibility.js",
  "/portal-login.js?v=17",
  "/login-routing.js",
  "/principal-dashboard.js?v=25",
  "/principal-trusted-campus.js?v=4",
  "/campus-location-ui.css?v=1",
  "/principal-dashboard.css?v=17",
  "/school-memos.js?v=1",
  "/school-memos.css?v=1",
  "/school-memo-banner.js?v=9",
  "/school-memo-banner.css?v=9",
  "/school-memos-redirect.js?v=1",
  "/responsive.css?v=0.8.3",
  "/comfort-ui.css?v=0.8.8",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/attendigo-official-emblem.svg?v=5",
  "/assets/attendigo-official-lockup.svg?v=5",
  "/attendigo-brand-polish.css?v=2",
  "/parent-admin.css?v=8",
  "/schedule-mobile-layout.css?v=1",
  "/weekly-list-mobile.css?v=1",
  "/platform-plans-ui.js?v=8",
  "/platform-school-health.js?v=2"
];

// Cache the essential public offline tools before activation. Keep download
// concurrency bounded and do not warm unrelated portal modules on every device.
// The existing runtime fetch handlers still cache assets on demand.
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add("/offline-welcome.html");
    const required = [...new Set(OFFLINE_REQUIRED)].filter(url => url !== "/offline-welcome.html");
    // Small batches keep a school-wide wave of installations from fanning out
    // into hundreds of requests per browser. A failed required asset prevents activation.
    for (let i = 0; i < required.length; i += 4) {
      await Promise.all(required.slice(i, i + 4).map(url => cache.add(url)));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key.startsWith('attendigo-v') && key !== CACHE).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let payload={};
  try {payload=event.data?.json()||{}} catch {payload={}}
  const title=typeof payload.title==='string'?payload.title.slice(0,75):'Attendigo';
  const body=typeof payload.body==='string'?payload.body.slice(0,170):
    'An attendance update is available. Open Attendigo to view it securely.';
  let url='/parent-portal.html';
  if(typeof payload.url==='string'&&
     /^\/parent-portal\.html(?:#[a-zA-Z0-9?&=%._:-]{0,220})?$/.test(payload.url)) url=payload.url;
  const tag=typeof payload.tag==='string'&&/^attendigo-[a-z0-9-]{1,70}$/.test(payload.tag)?
    payload.tag:'attendigo-subject-update';
  event.waitUntil(self.registration.showNotification(title,{
    body,tag,icon:'/assets/attendigo-icon-192.png?v=3',
    badge:'/assets/attendigo-icon-192.png?v=3',
    data:{url},renotify:false
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const path=event.notification?.data?.url||'/parent-portal.html';
    const target=new URL(path,self.location.origin);
    if(target.origin!==self.location.origin||target.pathname!=='/parent-portal.html')return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      try{
        const current=new URL(client.url);
        if(current.origin===self.location.origin&&current.pathname==='/parent-portal.html'){
          if(client.navigate)await client.navigate(target.href);
          if(client.focus)await client.focus();
          return;
        }
      }catch{}
    }
    if(self.clients.openWindow)await self.clients.openWindow(target.href);
  })());
});

// Cache Storage can be missing or inaccessible on iOS. Never resolve a
// navigation with Response.error() solely because the offline shell is absent.
async function offlineCachedPage(path) {
  try { return await caches.match(path); } catch { return undefined; }
}

async function offlineNavigationFallback(preferred, allowWelcome = true) {
  if (preferred) {
    const prepared = await offlineCachedPage(preferred);
    if (prepared && prepared.ok) return prepared;
  }
  const welcome = allowWelcome ? await offlineCachedPage("/offline-welcome.html") : undefined;
  if (welcome && welcome.ok) return welcome;
  // No role tools or account data are exposed in this emergency document.
  // It has no external dependencies and does not claim that offline is ready.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendigo | Connection unavailable</title><style>html{color-scheme:light}body{font:16px system-ui,sans-serif;background:#f5f8fc;color:#153451;min-height:90vh;display:grid;place-items:center;margin:0;padding:24px;box-sizing:border-box}main{max-width:420px;background:#fff;padding:28px;border:1px solid #dce7f1;border-radius:20px}h1{font-size:28px}p{line-height:1.6}a{display:inline-block;background:#174b78;color:white;text-decoration:none;padding:14px 20px;border-radius:10px}</style><main><strong>Attendigo</strong><h1>Connection unavailable</h1><p>Your offline tools are not available in this browser right now. Reconnect and open Attendigo to prepare your authorized attendance tool.</p><a href="/portal-login.html">Try again</a></main></html>`, {
    status: 200,
    headers: {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}
  });
}

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
    '/force-password-change.html', '/class-qr-checkin.html', '/attendance-pin.html', '/staff-lunch-checkin.html', '/class-qr-monitor.html', '/portal.html',
    '/student-portal.html', '/parent-portal.html'].includes(url.pathname);
  const credentialKey = /^(?:password|passwd|pwd|pass|currentpassword|newpassword|confirmpassword|recoverycode|setupcode|accesstoken)$/i;
  if (isAccountPage && [...url.searchParams.keys()].some(key => credentialKey.test(key))) {
    event.respondWith(Response.redirect(new URL('/portal-login.html', url.origin).href, 303));
    return;
  }

  // Reloads and query-string variations of public offline tools use the same
  // canonical shell. Network failure, timeout, and server errors must not
  // replace a prepared attendance screen with a browser error or login page.
  if (request.mode === "navigate" && OFFLINE_TOOL_PAGES.includes(url.pathname)) {
    event.respondWith((async () => {
      const canonical = url.pathname;
      const fallback = () => offlineNavigationFallback(canonical);
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller && typeof setTimeout === "function" ? setTimeout(() => controller.abort(), 4500) : null;
      try {
        const fresh = await fetch(request, { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
        if (!fresh.ok || fresh.redirected) return await fallback();
        // Avoid caching unexpected HTML or redirected login responses as a tool.
        if (fresh.url && new URL(fresh.url).pathname !== canonical) return await fallback();
        if (fresh.headers && !(fresh.headers.get("content-type") || "").includes("text/html")) return await fallback();
        try { const cache = await caches.open(CACHE); await cache.put(canonical, fresh.clone()); } catch {}
        return fresh;
      } catch {
        return await fallback();
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    })());
    return;
  }

  // Authenticated dashboards are never served from the offline shell cache.
  if (["/portal.html", "/class-qr-monitor.html", "/principal.html", "/school-memos.html", "/admin-sdo-coordination.html", "/student-portal.html", "/parent-portal.html",
       "/force-password-change.html", "/attendance-pin.html", "/class-qr-checkin.html", "/staff-lunch-checkin.html", "/leave-form6.html"].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(async error=>{
      if(request.mode==='navigate')return offlineNavigationFallback(url.pathname==='/student-portal.html'?'/student-qr-offline.html':undefined, ['/student-portal.html','/portal.html'].includes(url.pathname));
      throw error;
    }));
    return;
  }

  // Authentication scripts must never remain stale across releases or domain changes.
  // They need the deployed code online, with cached copies available only offline.
  if (['/offline-account-guard.js','/portal-login.js', '/login-routing.js', '/student-portal.js', '/student-qr-scanner.js', '/student-qr-offline.js', '/student-qr-offline-page.js'].includes(url.pathname)) {
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

  // Native iOS form styling needs current CSS; never pin obsolete button layouts.
  // Keep scheduling and shared notification UI fresh without breaking offline operation.
  // Notifications change often; always prefer online JS/CSS to avoid old large-text layouts.
  // Unlike cache-first general assets, these role-critical resources prefer the deployed version.
  if (['/universal-notifications.js','/universal-notifications.css','/portal.js','/offline-attendance.js','/attendance-sync-center.js','/attendigo-help.css','/missing-scan-ui.js','/missing-scan-ui.css','/parent-push.js','/parent-push.css','/parent-subject.js','/parent-subject.css','/parent-portal.js','/parent-dashboard.js','/parent-admin.js','/parent-admin.css','/school-memo-banner.js','/school-memo-banner.css','/school-memos-redirect.js','/school-memos.js','/school-memos.css','/principal-dashboard.js','/principal-trusted-campus.js','/principal-dashboard.css','/leave-approval-inbox.js','/leave-approval-inbox.css','/staff-leave-ui.js','/staff-leave-ui.css','/leave-status-indicator.css','/special-program-batch-ui.js','/learner-roster-view.js','/learner-roster-view.css','/student-name-format.js','/teacher-learner-roster.css','/portal.css','/guardian-ui.js','/manual-folio.js','/manual-folio.css','/schedule-form-layout.css','/schedule-workspace-ui.js','/teacher-assignment-modal.css','/smart-attendance-overview.css','/role-controls-responsive.css','/typography.css','/attendigo-layout-density.css','/app-dialog.css','/app-dialog.js','/form48-intelligence.js','/staff-ob-ui.js','/locator-slip-ui.js','/locator-template-library.js','/central-locator-ui.js','/locator-table-suggest.js','/locator-field-library.js','/document-branding.css','/form48-bulk-ui.js','/admin-request-notifications.js','/gate-offline-review.js','/gate-offline.js','/planner.js','/platform-plans-ui.js','/class-qr-teacher.js','/shs-school-ui.js','/flicker-diagnostics.js','/mobile-overflow-repair.css','/user-management-readability.css','/form48-report.css','/class-qr-monitor.js','/class-qr-monitor-embedded.css','/class-qr-dashboard-link.js','/attendigo-form-overlap-guard.css','/school-weather-widget.js','/attendigo-signature.css','/campus-location-ui.css','/staff-department-location.js','/staff-lunch-ui.js'].includes(url.pathname)) {
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
          try { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); } catch {}
        }
        return response;
      } catch {
        // The official-domain service worker can show the branded offline
        // welcome on previously visited devices; the separate static welcome
        // origin cannot intercept an offline request to attendigo.tech.
        // Keep QR attendance and role-specific offline pages unchanged.
        if (["/", "/index.html", "/portal-login.html", "/offline-welcome.html"].includes(url.pathname)) {
          return offlineNavigationFallback();
        }
        const cached = await offlineCachedPage(request);
        if (cached && cached.ok) return cached;
        return offlineNavigationFallback();
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
