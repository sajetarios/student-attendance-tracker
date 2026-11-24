'use strict';
// Static welcome-origin worker: cache only the public welcome document.
// Never intercept the official Attendigo login, school APIs, or QR operations.
const CACHE = 'attendigo-welcome-offline-v1';
const WELCOME_PATH = '/index.html';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(WELCOME_PATH);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key.startsWith('attendigo-welcome-offline-') && key !== CACHE
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname !== '/' && url.pathname !== '/index.html') return;
  // The live page is authoritative. If offline, return the previously cached
  // document; its own UI shows 'You're offline' and provides a retry option.
  event.respondWith((async () => {
    try {
      return await fetch(request, { cache: 'no-store' });
    } catch {
      return (await caches.match(WELCOME_PATH)) || Response.error();
    }
  })());
});
