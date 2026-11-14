'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'comfort-ui.css'), 'utf8');

test('sidebar groups expand and collapse using accessible expanded state', () => {
  assert.ok(html.includes('data-nav-group="people"'));
  assert.ok(html.includes('data-submenu="people"'));
  assert.ok(js.includes("querySelectorAll('.nav-group-toggle[data-nav-group]')"));
  assert.ok(js.includes("toggle.setAttribute('aria-expanded', String(!expanded))"));
  assert.ok(js.includes("if (submenu) submenu.hidden = expanded"));
});

test('cloud status distinguishes local server availability from cloud replication', () => {
  assert.ok(html.includes('id="connectionStatus"'));
  assert.ok(html.includes('Checking cloud sync status…'));
  assert.ok(js.includes("api('/api/cloud-sync/status')"));
  assert.ok(js.includes('Cloud sync not configured'));
  assert.ok(css.includes('.connection-chip.local-only'));
});

test('student, teacher, and staff tables become readable cards on narrow screens', () => {
  assert.ok(html.includes('id="studentRosterTable"'));
  assert.ok(html.includes('id="teacherMonitorTable"'));
  assert.ok(html.includes('id="staffAccountsTable"'));
  assert.ok(css.includes('#studentRosterTable tr'));
  assert.ok(css.includes('#teacherMonitorTable tr'));
  assert.ok(css.includes('#staffAccountsTable tr'));
});

test('roster exports are available as role-specific CSV actions', () => {
  assert.ok(html.includes('id="exportStudentsButton"'));
  assert.ok(html.includes('id="exportTeachersButton"'));
  assert.ok(js.includes("exportCsv('student-roster.csv'"));
  assert.ok(js.includes("exportCsv('teacher-list.csv'"));
});

test('all browser-native confirmation and prompt dialogs use the shared in-app dialog component', () => {
  const readFile = name => fs.readFileSync(path.join(root, name), 'utf8');
  const portal = readFile('public/portal.js');
  const parentAdmin = readFile('public/parent-admin.js');
  const academicAdmin = readFile('public/academic-admin.js');
  const nativeConfirm = /(?:window\s*\.\s*|^|[^.\w])confirm\s*\(/m;
  const nativePrompt = /(?:window\s*\.\s*|^|[^.\w])prompt\s*\(/m;
  const nativeAlert = /window\s*\.\s*alert\s*\(/;
  for (const [name, source] of [['portal', portal], ['parent admin', parentAdmin], ['academic admin', academicAdmin]]) {
    assert.equal(nativeConfirm.test(source) || nativePrompt.test(source) || nativeAlert.test(source), false, name + ' must not use native browser dialogs');
    assert.match(source, /AppDialog\.(?:alert|confirm|prompt)/, name + ' should use the shared dialog component');
  }
  const dialog = readFile('public/app-dialog.js');
  const portalHtml = readFile('public/portal.html');
  const parentHtml = readFile('public/parent-admin.html');
  const serviceWorker = readFile('public/sw.js');
  assert.ok(dialog.includes("panel.setAttribute('role', 'dialog')"));
  assert.ok(dialog.includes("panel.setAttribute('aria-modal', 'true')"));
  assert.ok(dialog.includes("field.setAttribute('aria-invalid', 'true')"));
  assert.ok(portalHtml.includes('/app-dialog.css?v=1'));
  assert.ok(portalHtml.includes('/app-dialog.js?v=1'));
  assert.ok(parentHtml.includes('/app-dialog.css?v=1'));
  assert.ok(parentHtml.includes('/app-dialog.js?v=1'));
  assert.ok(serviceWorker.includes('school-attendance-shell-v30-mobile-roster'));
  assert.ok(serviceWorker.includes('/app-dialog.js?v=1'));
});
