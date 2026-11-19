'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..',file),'utf8');
const html=read('public/portal.html');
const portal=read('public/portal.js');
const worker=read('public/sw.js');
const teacher=read('public/class-qr-dashboard-link.js');
const monitor=read('public/class-qr-monitor.js');

test('School Admin quick-management card routes to school-wide class attendance monitoring, not SF2',()=>{
  const card = html.match(/<section class="admin-command-panel" aria-label="Quick management">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.equal((card.match(/<button /g) || []).length, 6, 'The six compact admin shortcuts remain intact');
  assert.ok(card.includes('data-admin-view="classQrMonitor"'), 'Admin monitoring tile exists');
  assert.ok(card.includes('<strong>Class Attendance Monitoring</strong>'), 'Tile has the correct label');
  assert.ok(!card.includes('data-admin-view="sf2"'), 'Old inaccessible SF2 tile removed');
  assert.ok(!card.includes('<strong>SF2 reports</strong>'), 'Old SF2 shortcut is not displayed');
  assert.match(portal,/view === 'classQrMonitor'[\s\S]{0,220}window\.location\.assign\('\/class-qr-monitor\.html'\)/);
  assert.match(portal,/if \(user\?\.role !== 'SCHOOL_ADMIN'\) return;/);
  assert.match(monitor,/user\?\.role !== 'SCHOOL_ADMIN'/);
  assert.doesNotMatch(card,/class-qr-teacher\.html/);
});

test('SF2 workflows and teacher QR launch remain untouched by admin tile replacement',()=>{
  assert.ok(html.includes('id="sf2View"'));
  assert.ok(html.includes('id="sf2SubmissionsCard"'));
  assert.ok(html.includes('id="sf2SubmitButton"'));
  assert.ok(html.includes('id="sf2Nav"'));
  assert.ok(html.includes('data-go="sf2"'),'Existing role-filtered SF2 action remains');
  assert.ok(portal.includes("if (role === 'DEPARTMENT_HEAD') return ['dashboard'"));
  assert.ok(portal.includes("views.push('sf2')"));
  assert.ok(teacher.includes("if (user.role !== 'TEACHER') return"));
  assert.ok(teacher.includes("link.href = '/class-qr-teacher.html'"));
});

test('Cached admin shortcut script uses updated portal version',()=>{
  assert.ok(html.includes('/portal.js?v=202'));
  assert.ok(worker.includes('"/portal.js?v=202"'));
  const cacheVersion = worker.match(/const CACHE = "attendigo-v(\d+)-[^"]+"/);
  assert.ok(cacheVersion && Number(cacheVersion[1]) >= 220, "newer deployments must retain the admin shortcut cache update");
  assert.match(worker,/\/portal\.js\?v=202/);
});
