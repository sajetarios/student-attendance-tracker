'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('portal.html');
const css = read('class-attendance-mobile.css');
const register = read('manual-folio.js');
const qrShortcut = read('class-qr-dashboard-link.js');
const worker = read('sw.js');

test('class attendance mobile CSS is loaded after legacy styles', () => {
  assert.ok(html.includes('/class-attendance-mobile.css?v=1'));
  assert.ok(html.indexOf('/class-attendance-mobile.css?v=1') > html.indexOf('/manual-folio.css?v=11'));
  assert.match(css, /@media screen and \(max-width:767px\)/);
  assert.match(css, /#classAttendanceView \.manual-book #mfSheet \.manual-table\s*\{[^}]*min-width:0!important/);
  assert.match(css, /#classAttendanceView #mfSheet \.manual-table tbody tr\.manual-attendance-row/);
  assert.match(css, /grid-template-areas:"check learner learner note" "flip flip extras extras"/);
  assert.match(css, /#classAttendanceView #mfSheet \.manual-table thead\s*\{display:none!important/);
  assert.match(css, /@media screen and \(max-width:360px\)/);
});
test('mobile attendance keeps the existing marking, selection and note controls', () => {
  for (const hook of ['data-select=', 'data-flip-id=', 'data-status="LATE"', 'data-status="EXCUSED"', 'data-note=']) {
    assert.ok(register.includes(hook), hook + ' must still exist');
  }
  for (const cssHook of ['.manual-flip-card', '.manual-extra-status', '.manual-note-btn', 'input[type=checkbox]']) {
    assert.ok(css.includes(cssHook), cssHook + ' remains touch accessible');
  }
  assert.match(css, /min-height:46px!important/);
  assert.match(css, /\.manual-folio :is\(button,input,select,textarea\):focus-visible/);
});
test('teacher QR shortcut uses an inline attendance header location', () => {
  assert.ok(html.includes('class-qr-dashboard-link.js?v=13'));
  assert.ok(qrShortcut.includes("classAttendance.querySelector('.manual-head')"));
  assert.ok(qrShortcut.includes("link.classList.toggle('manual-qr-inline', Boolean(attendanceHost))"));
  assert.ok(qrShortcut.includes("if (classAttendance) observer.observe(classAttendance"));
  assert.ok(qrShortcut.includes("if (user.role !== 'TEACHER') return"));
  assert.ok(qrShortcut.includes("link.hidden = (user.role === 'TEACHER' && !inlineHost)"));
});
test('offline shell caches versioned class attendance assets', () => {
  assert.ok(worker.includes('attendigo-v328-mobile-class-register'));
  assert.ok(worker.includes('/class-attendance-mobile.css?v=1'));
  assert.ok(worker.includes('/class-qr-dashboard-link.js?v=13'));
});
