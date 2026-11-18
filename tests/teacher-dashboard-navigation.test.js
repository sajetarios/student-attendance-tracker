'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const html = read('portal.html');
const js = read('portal.js');
const qr = read('class-qr-dashboard-link.js');
const nav = html.match(/<nav class="side-nav"[\s\S]*?<\/nav>/)?.[0] || '';

test('teacher navigation keeps existing destinations and introduces accessible personal attendance group', () => {
  assert.match(nav, /id="personalAttendanceNavGroup" hidden/);
  assert.match(nav, /data-nav-group="personalAttendance" aria-expanded="true" aria-controls="personalAttendanceNavChildren"/);
  assert.match(nav, /id="personalAttendanceNavChildren" data-submenu="personalAttendance"/);
  for (const [id, route] of [
    ['studentsNav', 'students'], ['classAttendanceNav', 'classAttendance'],
    ['schedulesNav', 'schedules'], ['myGateAttendanceNav', 'myGateAttendance'],
    ['officialBusinessNav', 'officialBusiness'], ['teacherLunchQrNav', 'teacherLunchQr'],
    ['plannerNav', 'planner'], ['sf2Nav', 'sf2']
  ]) {
    assert.equal((nav.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id + ' is not duplicated');
    assert.ok(nav.includes('href="/portal.html?view=' + route + '"'), route + ' route preserved');
  }
});

test('teacher regrouping moves links rather than recreating permission-bearing controls', () => {
  assert.match(js, /teacher \? 'Teaching & Classes'/);
  assert.match(js, /teacher \? 'Planning'/);
  for (const [id, destination] of [
    ['classAttendanceNav', 'people'], ['schedulesNav', 'people'],
    ['myGateAttendanceNav', 'personalAttendance'],
    ['officialBusinessNav', 'personalAttendance'],
    ['teacherLunchQrNav', 'personalAttendance'], ['sf2Nav', 'reports']
  ]) assert.ok(js.includes("relocate('" + id + "', '" + destination + "')"));
  assert.ok(js.includes("if (role === 'TEACHER')"));
  assert.ok(js.includes("teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')"));
  assert.ok(js.includes("if (role === 'GATE_KEEPER') return ['students']"));
  assert.ok(js.includes("relocate('lunchQrAdminNav', 'operations')"), 'Admin operations unchanged');
  assert.ok(js.includes("relocate('form48ReportsNav', 'reports')"), 'Admin Form 48 reporting unchanged');
  assert.ok(js.includes("relocate('sf2Nav', 'reports')"), 'Reports remain available to eligible roles');
});

test('teacher dashboard is more compact without altering QR event handlers or school branding', () => {
  assert.match(html, /id="teacher-dashboard-navigation-layout"/);
  assert.match(html, /data-attendigo-role="TEACHER"/);
  assert.match(html, /id="dashboardOpenScanner"/);
  assert.match(html, /id="dashboardAddStudent"[^>]*hidden/);
  assert.match(js, /dashboardOpenScanner'\)\?\.addEventListener\('click'/);
  assert.match(js, /dashboardAddStudent'\)\?\.addEventListener\('click'/);
  assert.match(html, /id="schoolEmblem"/);
  assert.match(html, /id="plannerDashboardWidget"/);
});

test('class QR shortcut docks into teacher dashboard and roster; it cannot cover unrelated teacher screens', () => {
  assert.ok(qr.includes("user.role === 'TEACHER' && dashboardVisible"));
  assert.ok(qr.includes("dashboard.querySelector('.dashboard-quick-buttons')"));
  assert.ok(qr.includes("link.hidden = (user.role === 'TEACHER' && !inlineHost)"));
  assert.ok(qr.includes("observer.observe(dashboard"));
  assert.ok(qr.includes("link.href = '/class-qr-teacher.html'"));
  assert.match(html, /#classQrTeacherShortcut\[hidden\]\{display:none!important\}/);
});
