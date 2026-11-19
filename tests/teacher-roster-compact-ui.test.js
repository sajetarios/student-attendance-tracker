'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {assertCachedAsset}=require('./support/asset-contract');
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
  assert.match(main, /teacher\s*\? selectHeader \+ '<th>Learner<\/th><th>Class \/ Program<\/th>/);
  assert.match(main, /teacher \? \(4 \+ Number\(showSelectionColumn\)\)/);
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
  assert.match(shortcut, /if \(user\.role !== 'TEACHER'\) return/);
  assert.match(shortcut, /if \(user\.role === 'SCHOOL_ADMIN'\)/);
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
  assertCachedAsset(page,worker,'portal.js',{minimumVersion:203});
  for (const asset of ['/teacher-learner-roster.css?v=4','/class-qr-dashboard-link.js?v=9','/teacher-roster-popover.js?v=2']) {
    assert.ok(page.includes(asset), asset+' included in portal');
    assert.ok(worker.includes(JSON.stringify(asset)), asset+' cached');
  }
  assert.ok(page.includes('/class-qr-dashboard-link.js?v=9'));
  assert.ok(page.includes('/teacher-roster-popover.js?v=2'));
  assert.match(worker, /const CACHE = "attendigo-v\d+[^"]*"/);
});

test('four-column teacher table keeps guardian contact inside Actions, not the wide roster', () => {
  assert.match(main, /<th>Quick actions<\/th>/);
  assert.match(main, /<th>Class \/ Program<\/th>/);
  assert.match(main, /teacher \? \(4 \+ Number\(showSelectionColumn\)\)/);
  assert.match(main, /const teacherGuardian = teacher/);
  assert.match(main, /teacher-roster-menu-label/);
  assert.match(main, /teacherRosterInitials\(fullName\)/);
  assert.match(main, /student-initials-avatar/);
  assert.match(main, /classInfo =/);
  assert.match(main, /teacher-directory-mode/);
  assert.match(main, /<div class="teacher-roster-quick-actions">/);
  assert.match(main, /data-label="Actions"/);
  assert.match(main, /const adminQrAction = admin && canViewQr/);
  assert.match(main, /QR images are loaded on demand from Actions/);
  assert.match(main, /async function openStudentQrPreview\(student\)/);
  assert.ok(!main.includes('<th>Manage</th><th>Parent / guardian</th>'));
  assert.match(style, /width:238px/);
  assert.match(style, /position:fixed!important/);
});
test('QR shortcut cannot sit over header account controls when on roster', () => {
  assert.match(shortcut, /panel\.getClientRects\(\)\.length/);
  assert.match(shortcut, /#studentRosterPanel \.student-roster-viewbar/);
  assert.match(shortcut, /setProperty\('position', inlineHost \? 'static' : 'fixed', 'important'\)/);
  assert.match(style, /#classQrTeacherShortcut\.is-roster-inline/);
});
test('teacher dropdown supports keyboard dismissal and does not increase row height', () => {
  const popover = read('public/teacher-roster-popover.js');
  assert.match(popover, /addEventListener\('toggle'/);
  assert.match(popover, /addEventListener\('keydown'/);
  assert.match(popover, /event\.key !== 'Escape'/);
  assert.match(popover, /closeMenus/);
  assert.match(popover, /positionMenu/);
  assert.match(style, /\.student-actions-dropdown\[open\]>\.student-row-actions/);
  assert.match(popover, /data-guardian-open/);
  assert.match(popover, /data-edit-student/);
});

test('program request permissions and approval badges survive merged Class/Program cell', () => {
  assert.match(main, /rowgroup/);
  assert.match(main, /studentRosterSexCounts/);
  assert.match(main, /canSelectLearnerForBatch/);
  assert.match(main, /data-select-student/);
  assert.match(programs, /querySelector\('\[data-label="Special program"\]'\)/);
  assert.match(programs, /querySelector\('\[data-label="Actions"\]'\)/);
  assert.match(programs, /button.textContent='Request Program Change'/);
  assert.match(programs, /pendingInScope/);
  assert.match(main, /async function openStudentQrPreview\(student\)/);
});
test('compact CSS uses initials, dense rows, mobile cards, and theme contrast', () => {
  assert.match(style, /teacher-roster-initials/);
  assert.match(style, /border-radius:50%/);
  assert.match(style, /height:53px/);
  assert.match(style, /\.teacher-roster-class/);
  assert.match(style, /max-width:1180px/);
  assert.match(style, /@media\(max-width:700px\)/);
  assert.match(style, /@media\(max-width:390px\)/);
  assert.match(style, /html\[data-ui-theme="dark"\]/);
  assert.match(page, /id="studentRosterHeading"/);
});

test('teacher learner text hierarchy is calm, readable and confined to teacher roster', () => {
  const block = selector => {
    const start = style.indexOf(selector + '{');
    assert.ok(start >= 0, 'Missing CSS selector: ' + selector);
    const end = style.indexOf('}', start);
    return style.slice(start, end + 1);
  };
  const base = '#studentsView #studentRosterTable.teacher-roster-compact';
  assert.match(block(base + ' .teacher-roster-identity-copy strong'), /font-weight:600/);
  assert.match(block(base + ' .teacher-roster-identity-copy small'), /font-weight:400/);
  assert.match(block(base + ' td[data-label="Class"] .teacher-roster-class>strong'), /font-weight:500/);
  assert.match(block(base + ' .special-program-chip'), /font-weight:600/);
  assert.match(block(base + ' .teacher-roster-status'), /font-weight:500/);
  assert.match(block(base + ' .teacher-roster-qr'), /font-weight:500/);
  assert.match(block(base + ' .student-actions-dropdown>summary'), /font-weight:500/);
  assert.match(block(base + ' thead th'), /font-weight:600/);
  assert.match(block(base + ' tbody tr.teacher-roster-student td'), /height:53px/);
  assert.ok(!style.includes('.school-heading .school-title-block'), 'School heading styles must not be modified here');
});
