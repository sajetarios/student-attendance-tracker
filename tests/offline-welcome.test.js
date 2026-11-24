'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/offline-welcome.html'), 'utf8');

function requestServiceWorker(url, { offline = true, mode = 'navigate', hit = {}, method = 'GET' } = {}) {
  let handler;
  const self = {
    location: { origin: 'https://attendigo.tech' },
    addEventListener(name, fn) { if (name === 'fetch') handler = fn; }
  };
  const cache = {
    match: async input => hit[typeof input === 'string' ? input : input.url] || null,
    open: async () => ({ put: async () => {} })
  };
  const context = {
    self, URL, caches: cache,
    fetch: async () => {
      if (offline) throw new Error('Disconnected');
      return { ok: true, live: true, clone() { return this; } };
    },
    Response: { error: () => ({ failed: true }), redirect: () => ({ redirected: true }) }
  };
  vm.runInNewContext(script, context);
  const request = { url, mode, method, headers: { has: () => false } };
  let response = null;
  handler({ request, respondWith(value) { response = value; } });
  return response;
}

test('official homepage falls back to branded cached welcome when offline', async () => {
  const offline = { branded: true };
  const result = await requestServiceWorker('https://attendigo.tech/', {
    hit: { '/offline-welcome.html': offline }
  });
  assert.equal(await result, offline);
});

test('offline direct login uses welcome fallback without ever verifying attendance', async () => {
  const offline = { branded: true };
  const result = await requestServiceWorker('https://attendigo.tech/portal-login.html', {
    hit: { '/offline-welcome.html': offline }
  });
  assert.equal(await result, offline);
  assert.doesNotMatch(page, /fetch\(['"]\/api\/(?:attendance|gate|class-qr)/);
});

test('existing student offline QR fallback remains authoritative', async () => {
  const studentOffline = { studentOffline: true };
  const result = await requestServiceWorker('https://attendigo.tech/student-portal.html', {
    hit: { '/student-qr-offline.html': studentOffline }
  });
  assert.equal(await result, studentOffline);
});

test('API traffic is never cached or intercepted by offline welcome', async () => {
  const result = requestServiceWorker('https://attendigo.tech/api/startup-readiness');
  assert.equal(result, null);
});

test('online homepage still prefers the network', async () => {
  const result = await requestServiceWorker('https://attendigo.tech/', {
    offline: false,
    hit: { '/offline-welcome.html': { branded: true } }
  });
  assert.equal((await result).live, true);
});

test('fallback markup is branded, responsive, and has retry but no sign-in form', () => {
  assert.match(page, /attendigo-official-lockup\.svg/);
  assert.match(page, /id="retry"/);
  assert.match(page, /window\.addEventListener\('online'/);
  assert.match(page, /@media\(max-width:720px\)/);
  assert.doesNotMatch(page, /<form\b/i);
});
