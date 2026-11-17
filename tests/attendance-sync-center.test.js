'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Sync Center is loaded for staff dashboard and prepared offline attendance', () => {
  const html = read('public/portal.html');
  const offline = read('public/offline-sheet.html');
  const sw = read('public/sw.js');
  for (const file of ['attendance-sync-center.css?v=4','attendance-sync-center.js?v=3']) {
    assert.ok(html.includes('/' + file), 'Staff portal must load ' + file);
    assert.ok(sw.includes('"/' + file + '"'), 'Offline shell must cache ' + file);
  }
  assert.ok(offline.includes('/attendance-sync-center.css?v=4'));
  assert.ok(offline.includes('/attendance-sync-center.js?v=3'));
  assert.ok(offline.includes('data-offline-sheet="true"'));
});

test('the Sync Center distinguishes school-server acknowledgment from cloud delivery', () => {
  const ui = read('public/attendance-sync-center.js');
  for (const label of [
    'Saved on device', 'Waiting to sync', 'Needs review', 'Last school acceptance',
    'School cloud replication', 'Waiting for cloud', 'Needs administrator review',
    'Cloud forwarding is disabled', 'It does not guarantee school-to-cloud delivery'
  ]) assert.ok(ui.includes(label), 'Missing explicit queue status ' + label);
  assert.match(ui, /role\(\)\.role === 'SCHOOL_ADMIN'/);
  assert.match(ui, /if \(!isAdmin\(\) \|\| !dialog\.open\) return/);
  assert.match(ui, /getQueue\(\)\.inspect\(operationId\)/);
  assert.match(ui, /\/api\/manual-attendance\?/);
  assert.match(ui, /getQueue\(\)\.retryReviewed\(record\.id\)/);
  assert.match(ui, /\/api\/cloud-sync\/retry/);
  assert.match(ui, /server will still enforce its current revisions/);
  assert.doesNotMatch(ui, /forceOverwrite|clearPending|deleteAttendance|reassignLearner/);
});

test('the page-flip register keeps interactive book layout and explicit sync statuses', () => {
  const html = read('public/portal.html');
  const js = read('public/manual-folio.js');
  const css = read('public/manual-folio.css');
  assert.ok(html.includes('id="mfBook"'));
  assert.ok(html.includes('id="mfSyncStrip"'));
  assert.ok(html.includes('id="mfSyncPill"'));
  assert.ok(html.includes('id="mfOpenSyncCenter"'));
  assert.match(js, /setSyncPill\('local','Saved on device'/);
  assert.match(js, /setSyncPill\('waiting','Waiting to sync'/);
  assert.match(js, /setSyncPill\('synced','Verified in school records'/);
  assert.match(js, /Sign-off queued/);
  assert.match(js, /Attendig[oO]Offline\.enqueueOperation/);
  assert.ok(css.includes('manual-turn-leaf') || css.includes('manual-book.turn-next'));
});

test('Sync Center is mobile, accessible and dark-mode aware', () => {
  const css = read('public/attendance-sync-center.css');
  const js = read('public/attendance-sync-center.js');
  assert.match(css, /body\.dark-mode/);
  assert.match(css, /body\[data-theme="dark"\]/);
  assert.match(css, /html\[data-offline-sheet="true"\]/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /:focus-visible/);
  assert.match(js, /setAttribute\('aria-labelledby', 'ascTitle'\)/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /textContent/);
  assert.match(js, /addEventListener\('online'/);
});

test('account-scoped encrypted queue has inspect and authorized retry, not overwrite', () => {
  const queue = read('public/offline-attendance.js');
  assert.match(queue, /async function inspect\(operationId\)/);
  assert.match(queue, /record\.owner !== currentOwner/);
  assert.match(queue, /async function retryReviewed\(operationId\)/);
  assert.match(queue, /record\.status !== 'REVIEW'/);
  assert.match(queue, /return sync\(\); \/\/ Server still checks revisions/);
  assert.match(queue, /lastConfirmedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(queue, /'attendigo-offline-status'/);
});

test('single unified Sync Center is triggered from the existing responsive header', () => {
  const css = read('public/attendance-sync-center.css');
  const ui = read('public/attendance-sync-center.js');
  const portal = read('public/portal.html');
  const portalJs = read('public/portal.js');
  const offlineSheet = read('public/offline-sheet.html');
  const sw = read('public/sw.js');
  const qr = read('public/class-qr-dashboard-link.js');
  assert.match(portal, /<button[^>]*class="connection-chip local-only asc-header-trigger" id="connectionStatus"/);
  assert.match(portal, /aria-controls="attendanceSyncDialog"/);
  assert.match(portal, /id="syncHeaderLabel"/);
  assert.match(portal, /class="asc-header-badge" hidden/);
  assert.match(ui, /let trigger = \$\('connectionStatus'\)/);
  assert.match(ui, /trigger\.addEventListener\('click', open\)/);
  assert.match(ui, /document\.documentElement\.dataset\.offlineSheet === 'true'/);
  assert.match(ui, /if \(role\(\)\.role === 'SUPER_ADMIN'\)/);
  assert.match(ui, /function setCloudStatus\(status, error = ''\)/);
  assert.match(portalJs, /AttendigoSyncCenter\.setCloudStatus/);
  assert.match(ui, /if \(!isAdmin\(\)\) return/);
  assert.match(ui, /Cloud sync not configured/);
  assert.match(ui, /Cloud forwarding disabled/);
  assert.match(ui, /needsReview/);
  assert.match(ui, /trigger\.setAttribute\('aria-label', 'Open Attendance Sync Center/);
  assert.match(css, /#connectionStatus\.asc-header-trigger/);
  assert.match(css, /@media\(max-width:920px\)/);
  assert.match(css, /#connectionStatus\.asc-header-trigger\[hidden\]/);
  assert.doesNotMatch(ui, /id = 'ascDock'|className\s*=\s*'asc-dock'/);
  assert.doesNotMatch(css, /#ascDock|body:has\(#classQrTeacherShortcut\)/);
  assert.doesNotMatch(ui, /id = 'ascDashboardCard'/);
  assert.match(qr, /const linkId = 'classQrTeacherShortcut'/);
  assert.match(qr, /position:fixed;right:18px;bottom:18px/);
  assert.match(offlineSheet, /attendance-sync-center\.css\?v=4/);
  assert.match(offlineSheet, /attendance-sync-center\.js\?v=3/);
  assert.match(sw, /const CACHE = "attendigo-v\d+-/);
  assert.match(sw, /"\/attendance-sync-center\.css\?v=4"/);
  assert.match(sw, /"\/attendance-sync-center\.js\?v=3"/);
});
