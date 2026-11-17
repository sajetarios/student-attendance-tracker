'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('device offline queue isolates by school and user and keeps event UUID', () => {
  const js = read('public/offline-attendance.js');
  assert.match(js, /String\(u\.schoolId\) \+ ':' \+ String\(u\.userId\)/);
  assert.match(js, /id: event\.eventId/);
  assert.match(js, /status: 'PENDING'/);
  assert.match(js, /status: 'REVIEW'/);
  assert.match(js, /response\.status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(js, /localStorage\.setItem\([^\n]*accessToken/);
});

test('manual folio stores drafts by school, teacher, class and date', () => {
  const js = read('public/manual-folio.js');
  assert.match(js, /const scope=\[user\.schoolId\|\|'school',user\.userId\|\|user\.id\|\|'teacher'\]/);
  assert.match(js, /const key=\(\)=>\['attendigo\.manual\.v1',scope,state\.period\?\.periodId\|\|'none',state\.date\]/);
});

test('service worker caches offline attendance assets but not private API/dashboard pages', () => {
  const js = read('public/sw.js');
  assert.match(js, /offline-attendance\.js\?v=1/);
  assert.match(js, /manual-folio\.js\?v=9/);
  assert.match(js, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(js, /"\/portal\.html"/);
  assert.match(js, /fetch\(request, \{ cache: "no-store" \}\)/);
});

test('standalone offline sheet encrypts student data and checks account before upload', () => {
  const js = read('public/offline-sheet.js');
  assert.match(js, /PBKDF2/);
  assert.match(js, /AES-GCM/);
  assert.match(js, /u\.schoolId!==data\.schoolId\|\|u\.userId!==data\.userId/);
  assert.match(js, /\/api\/manual-attendance\/sync/);
  assert.match(js, /Server verification failed/);
  const sw = read('public/sw.js');
  assert.match(sw, /offline-sheet\.html/);
  assert.match(sw, /offline-sheet\.js\?v=1/);
});
