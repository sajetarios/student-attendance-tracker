'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const main = read('public/portal.js');
const page = read('public/portal.html');
const style = read('public/teacher-learner-roster.css');
const shortcut = read('public/class-qr-dashboard-link.js');
const worker = read('public/sw.js');
const programs = read('public/special-program-ui.js');

test('teacher roster compresses identity, class, QR and guardian without changing admin/dept layouts', () => {
  assert.match(main, /rosterTable\?\.classList\.toggle\('teacher-roster-compact', teacher\)/);
  assert.match(main, /teacher\s*\? selectHeader \+ '<th>Learner<\/th><th>Class<\/th>/);
  assert.match(main, /teacher \? \(7 \+ Number\(showSelectionColumn\)\)/);
  for (const name of ['teacher-roster-identity', 'teacher-roster-guardian','teacher-roster-status','teacher-roster-qr'])
    assert.ok(main.includes(name), name);
  assert.match(main, /data-student-enrollment/);
  assert.match(main, /data-label="Special program"/);
  assert.match(main, /data-view-qr/);
  assert.match(main, /data-select-student/);
  assert.match(main, /data-student-photo/);
  assert.ok(programs.includes('[data-label="Special program"]'));
});
test('the QR attendance shortcut moves into the roster toolbar only after role verification', () => {
  assert.match(shortcut, /fetch\('\/api\/auth\/me'/);
  assert.match(shortcut, /!\['TEACHER', 'SCHOOL_ADMIN'\]\.includes\(user\.role\)/);
  assert.match(shortcut, /#?studentsView/);
  assert.match(shortcut, /\.student-roster-viewbar/);
  assert.match(shortcut, /MutationObserver\(positionShortcut\)/);
  assert.match(shortcut, /is-roster-inline/);
  assert.ok(!shortcut.includes('style.cssText'));
});
test('responsive teacher roster keeps grouped sex counts, readable cards and dark mode', () => {
  assert.match(main, /groupedRoster \? '<span class=/);
  assert.match(main, /student-sex-group/);
  assert.match(style, /@media\(max-width:700px\)/);
  assert.match(style, /\.student-sex-group/);
  assert.match(style, /html\[data-ui-theme="dark"\]/);
  assert.match(style, /:focus-visible/);
});
test('PWA asset versions match the new styling and scripts', () => {
  for (const asset of ['/teacher-learner-roster.css?v=1','/portal.js?v=0.9.137']) {
    assert.ok(page.includes(asset), asset+' included in portal');
    assert.ok(worker.includes(JSON.stringify(asset)), asset+' cached');
  }
  assert.ok(page.includes('/class-qr-dashboard-link.js?v=5'));
  assert.match(worker, /const CACHE = "attendigo-v\d+[^"]*"/);
});
