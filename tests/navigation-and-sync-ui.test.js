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
  const portal = read('public/portal.js');
  const parentAdmin = read('public/parent-admin.js');
  const academicAdmin = read('public/academic-admin.js');
  for (const [name, source] of [['portal', portal], ['parent admin', parentAdmin], ['academic admin', academicAdmin]]) {
    assert.doesNotMatch(source, /\\b(?:window\\.)?(?:alert|confirm|prompt)\\s*\\(/, name + ' must not use native browser dialogs');
    assert.match(source, /AppDialog\\.(?:alert|confirm|prompt)/, name + ' should use the shared dialog component');
  }
  const dialog = read('public/app-dialog.js');
  const portalHtml = read('public/portal.html');
  const parentHtml = read('public/parent-admin.html');
  assert.match(dialog, /aria-modal/);
  assert.match(dialog, /role', 'dialog'/);
  assert.match(dialog, /aria-invalid/);
  assert.match(portalHtml, /app-dialog\\.css\\?v=1/);
  assert.match(portalHtml, /app-dialog\\.js\\?v=1/);
  assert.match(parentHtml, /app-dialog\\.css\\?v=1/);
  assert.match(parentHtml, /app-dialog\\.js\\?v=1/);
});
