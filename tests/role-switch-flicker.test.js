'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const guardSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'session-guard.js'), 'utf8');
const portalSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.js'), 'utf8');
const headerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-header-responsive.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw-refresh.js'), 'utf8');

function createGuardHarness() {
  const listeners = new Map();
  const session = new Map([['schoolAttendance.accessToken', 'department-token']]);
  const doc = {
    hidden: false,
    documentElement: { dataset: { protectedRole: 'STAFF' }, style: { visibility: '' } },
    body: { children: [] },
    getElementById: () => null,
    addEventListener: (name, fn) => listeners.set('document:' + name, fn)
  };
  const redirects = [];
  const win = {
    location: { replace: url => redirects.push(url) },
    addEventListener: (name, fn) => listeners.set('window:' + name, fn)
  };
  let responses = 0;
  let postpone = null;
  const fetch = async () => {
    responses += 1;
    if (postpone) await postpone;
    return { ok: true, status: 200, json: async () => ({ user: { role: 'DEPARTMENT_HEAD' } }) };
  };
  vm.runInNewContext(guardSource, {
    document: doc, window: win, fetch,
    sessionStorage: {
      getItem: key => session.get(key) || null,
      removeItem: key => session.delete(key)
    }
  });
  const emit = (name, arg = {}) => listeners.get(name)(arg);
  return { doc, emit, redirects, session, get requests() { return responses; }, delay: promise => { postpone = promise; } };
}

test('role switching does not reveal a generic admin dashboard before department navigation is ready', async () => {
  const h = createGuardHarness();
  h.emit('window:pageshow', { persisted: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.doc.documentElement.style.visibility, 'hidden');
  h.emit('document:attendigo:portal-ready');
  assert.equal(h.doc.documentElement.style.visibility, '');
  assert.match(portalSource, /document\.dispatchEvent\(new Event\('attendigo:portal-ready'\)\)/);
});

test('focus-time session checks do not blank an already verified department dashboard', async () => {
  const h = createGuardHarness();
  h.emit('window:pageshow', { persisted: false });
  await new Promise(resolve => setImmediate(resolve));
  h.emit('document:attendigo:portal-ready');
  let finish;
  h.delay(new Promise(resolve => { finish = resolve; }));
  h.emit('document:visibilitychange');
  assert.equal(h.doc.documentElement.style.visibility, '');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.doc.documentElement.style.visibility, '');
});

test('history-restored dashboard is hidden and redirected when an account has logged out', () => {
  const h = createGuardHarness();
  h.session.delete('schoolAttendance.accessToken');
  h.emit('window:pageshow', { persisted: true });
  assert.equal(h.doc.documentElement.style.visibility, 'hidden');
  assert.deepEqual(h.redirects, ['/portal-login.html']);
});

test('school header is not resized by a scroll listener', () => {
  assert.doesNotMatch(headerSource, /addEventListener\(['"]scroll['"]/);
  assert.match(headerSource, /classList\.remove\('is-compact'\)/);
});

test('newly signed-in dashboard is not forcibly reloaded by worker takeover', () => {
  assert.match(workerSource, /performance\.now\(\) - loadedAt < 20000/);
});
