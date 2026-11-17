'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('device offline queue isolates by school and user and keeps event UUID', () => {
  const js = read('public/offline-attendance.js');
  assert.match(js, /String\(u\.schoolId\) \+ ':' \+ String\(u\.userId\)/);
  assert.match(js, /operationId: event\.eventId/);
  assert.match(js, /status: 'PENDING'/);
  assert.match(js, /status: 'REVIEW'/);
  assert.match(js, /AES-GCM/);
  assert.match(js, /REGISTER_SIGNOFF/);
  assert.match(js, /MANUAL_MARKS/);
  assert.match(js, /QR_SCAN/);
  assert.match(js, /record\.event && !record\.encrypted/);
  assert.match(js, /response\.status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(js, /localStorage\.setItem\([^\n]*accessToken/);
});

test('manual folio stores drafts by school, teacher, class and date', () => {
  const js = read('public/manual-folio.js');
  assert.match(js, /const scope=\[user\.schoolId\|\|'school',user\.userId\|\|user\.id\|\|'teacher'\]/);
  assert.match(js, /const key=\(\)=>\['attendigo\.manual\.v1',scope,state\.period\?\.periodId\|\|'none',state\.date\]/);
});

test('service worker caches offline attendance assets but not private API/dashboard pages', () => {
  let handleFetch;
  const fetched = [];
  const origin = 'https://school.example';
  const worker = read('public/sw.js');
  vm.runInNewContext(worker, {
    URL,
    self: {
      location: { origin },
      addEventListener(type, listener) {
        if (type === 'fetch') handleFetch = listener;
      },
    },
    fetch(request, options) {
      fetched.push([request.url, options.cache]);
      return Promise.resolve();
    },
  });

  function request(path, authorized = false) {
    let handled = false;
    handleFetch({
      request: { method: 'GET', url: origin + path, headers: { has: () => authorized } },
      respondWith() { handled = true; },
    });
    return handled;
  }

  assert.equal(request('/api/students'), false);
  assert.equal(request('/private', true), false);
  assert.equal(request('/portal.html'), true);
  assert.deepEqual(fetched, [[origin + '/portal.html', 'no-store']]);
  const shell = worker.split('const SHELL = [')[1]?.split('];')[0] || '';
  assert.doesNotMatch(shell, /"\/portal\.html"/);
  for (const asset of ['offline-attendance.js', 'manual-folio.js']) {
    const url = read('public/portal.html').split('"').find(value => value.startsWith(`/${asset}?v=`));
    assert.ok(url && shell.includes(JSON.stringify(url)), `Missing cached dashboard asset ${asset}`);
  }
});

test('standalone offline sheet encrypts student data and checks account before upload', () => {
  const js = read('public/offline-sheet.js');
  assert.match(js, /PBKDF2/);
  assert.match(js, /AES-GCM/);
  assert.match(js, /u\.schoolId!==data\.schoolId\|\|u\.userId!==data\.userId/);
  assert.match(js, /type:'MANUAL_MARKS'/);
  assert.match(js, /Server verification failed/);
  const sw = read('public/sw.js');
  assert.match(sw, /offline-sheet\.html/);
  const script = read('public/offline-sheet.html').match(/src="(\/offline-sheet\.js\?v=[^"]+)"/)?.[1];
  assert.ok(script && sw.includes(JSON.stringify(script)));
  assert.match(read('public/offline-sheet.html'), /offline-attendance\\.js\\?v=/);
});
