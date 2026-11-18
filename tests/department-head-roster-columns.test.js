'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'student-roster-toolbar.css'), 'utf8');

test('Department Heads keep a useful roster without a useless Select column', () => {
  assert.match(portal, /const hasSelectableLearners = visible\.some\(canSelectLearnerForBatch\)/);
  assert.match(portal, /const selectHeader = showSelectionColumn \? '<th>Select<\/th>' : ''/);
  assert.match(portal, /rosterHeader\.innerHTML = departmentHead/);
  assert.match(portal, /const rosterColumns = departmentHead/);
  assert.match(portal, /showSelectionColumn \? 9 : 8/);
  assert.match(portal, /departmentHead \? '' : await photoDataUrl\(student\.photoUrl\)/);
  assert.doesNotMatch(portal, /Only your department’s assigned sections can be selected/);
  assert.match(html, /id="studentRosterDescription"/);
});

test('Batch tools are hidden for roles and filters without selectable learners', () => {
  assert.ok(portal.includes('bulkActions.hidden = !canBatchManage || (!admin && !hasSelectableLearners)'));
  assert.ok(portal.includes('hasSelectableLearners = visible.some(canSelectLearnerForBatch)'));
  assert.ok(portal.includes("p.scheduleDepartmentId"));
  assert.match(css, /\.student-bulk-actions\[hidden\]\{display:none!important;\}/);
});

test('School Admin retains full roster, action controls and selected ID cards', () => {
  assert.match(portal, /selectHeader \+ '<th>Photo<\/th><th>Student ID<\/th>/);
  assert.match(portal, /const adminQrAction = admin && canViewQr/);
  assert.match(portal, /data-label="Actions"/);
  assert.doesNotMatch(portal, /data-label="Student account"/);
  assert.doesNotMatch(portal, /data-label="QR code"/);
  assert.match(portal, /data-select-student/);
});

test('Versioned roster resources match service worker shell', () => {
  for (const name of ['portal.js','student-roster-toolbar.css']) {
    const source = html.match(new RegExp('(?:src|href)="(\\/' + name.replaceAll('.', '\\.') + '\\?v=[^"]+)"'))?.[1];
    assert.ok(source, 'Missing '+name+' version');
    assert.ok(worker.includes(JSON.stringify(source)), 'Service worker must match '+name);
  }
});
