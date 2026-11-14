'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('authenticated portal explicitly checks for service-worker updates and reloads after takeover', () => {
  const html = read('public/portal.html');
  const updater = read('public/sw-refresh.js');
  const worker = read('public/sw.js');
  assert.ok(html.includes('/sw-refresh.js?v=1'));
  assert.ok(html.includes('/portal.js?v=0.9.18'));
  assert.ok(updater.includes("register('/sw.js', { updateViaCache: 'none' })"));
  assert.ok(updater.includes('registration.update()'));
  assert.ok(updater.includes("addEventListener('controllerchange'"));
  assert.ok(updater.includes('window.location.reload()'));
  assert.ok(worker.includes('school-attendance-shell-v30-mobile-roster'));
  assert.ok(worker.includes('/portal.js?v=0.9.18'));
  assert.ok(worker.includes('/sw-refresh.js?v=1'));
  assert.ok(worker.includes('/form-system.css?v=1'));
});
