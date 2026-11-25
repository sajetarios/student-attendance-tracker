'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const worker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

async function simulateInstall(failPath) {
  const handlers = {};
  const requests = [];
  let active = 0, peak = 0, activated = false;
  vm.runInNewContext(worker, {
    self: { addEventListener(name, fn) { handlers[name] = fn; },
      async skipWaiting() { activated = true; } },
    caches: { async open() { return { async add(url) {
      requests.push(url); active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        if (url === failPath) throw new Error('offline asset unavailable');
      } finally { active--; }
    } }; } }
  });
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } });
  let error;
  try { await pending; } catch (e) { error = e; }
  return { requests, peak, activated, error };
}

test('shared PWA install keeps required offline tools ready with bounded network concurrency', async () => {
  const { requests, peak, activated, error } = await simulateInstall();
  assert.ifError(error);
  assert.equal(activated, true);
  assert.ok(peak <= 4, 'no more than four precache downloads at a time');
  assert.equal(new Set(requests).size, requests.length);
  assert.ok(requests.length <= 32, 'no unrelated portal-wide precache');
  for (const page of ['offline-welcome.html', 'offline-sheet.html', 'gate-offline.html', 'student-qr-offline.html']) {
    assert.ok(requests.includes('/' + page));
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["'](\/[^"']+)["']/gi)) {
      assert.ok(requests.includes(match[1]), page + ' missing ' + match[1]);
    }
  }
  assert.ok(requests.includes('/vendor/html5-qrcode.min.js'));
  assert.ok(!requests.some(url => /principal-dashboard|parent-admin|portal\.js/.test(url)));
});

test('a failed essential offline download does not replace the active worker', async () => {
  const { error, activated } = await simulateInstall('/offline-sheet.html');
  assert.ok(error);
  assert.equal(activated, false);
});
