'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline-attendance.js'), 'utf8');

// A shared, asynchronous IndexedDB model. Deliberately forces the first two
// event reads to observe absence before either writer can claim the ID.
// Real Chromium/WebKit IndexedDB and full server replay are separate release gates.
function device() {
  const stores = { events: new Map(), keys: new Map() };
  const waiters = [];
  const statuses = [];
  let unavailable = false;
  const network = { onLine: false };
  let reads = 0;
  const db = {
    close() {},
    transaction(name) {
      const map = stores[name];
      const tx = { error: null, abort() { this.onabort?.(); } };
      function request(work, barrier = false) {
        const req = {};
        const run = () => {
          try {
            req.result = work();
            req.onsuccess?.();
            tx.oncomplete?.();
          } catch (error) {
            tx.error = error;
            tx.onabort?.();
          }
        };
        if (barrier && reads++ < 2) {
          waiters.push(run);
          if (waiters.length === 2) setImmediate(() => waiters.splice(0).forEach(fn => fn()));
        } else setImmediate(run);
        return req;
      }
      tx.objectStore = () => ({
        get: id => request(() => map.get(id), name === 'events'),
        add: value => request(() => {
          if (map.has(value.id)) throw Error('ConstraintError');
          map.set(value.id, value);
        }),
        put: value => request(() => map.set(value.id, value)),
        delete: id => request(() => map.delete(id)),
        index: () => ({ getAll: owner => request(() => [...map.values()].filter(row => row.owner === owner)) })
      });
      return tx;
    }
  };
  const indexedDB = { open() {
    const req = { result: db };
    setImmediate(() => { if (unavailable) { req.error = Error('Storage unavailable'); req.onerror?.(); } else req.onsuccess?.(); });
    return req;
  }};
  function tab(schoolId, userId) {
    const window = { dispatchEvent(event) { statuses.push(event.detail); } };
    const context = vm.createContext({
      window, indexedDB, crypto: webcrypto, TextEncoder, TextDecoder,
      navigator: network,
      sessionStorage: { getItem: () => JSON.stringify({ schoolId, userId, role: 'TEACHER' }) },
      document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
      CustomEvent: class { constructor(_type, init) { this.detail = init.detail; } }
    });
    vm.runInContext(source, context);
    return window.AttendigoOffline;
  }
  return { tab, stores, statuses, failStorage() { unavailable = true; }, reconnect() { network.onLine = true; } };
}
const operation = status => ({
  operationId: 'shared-event-id', type: 'MANUAL_MARKS',
  payload: { periodId: 'period', date: '2026-11-28', marks: [{ studentId: 'learner', status }] }
});

test('concurrent same-account identical operation retries keep one immutable record', async () => {
  const d = device(), a = d.tab('school', 'teacher'), b = d.tab('school', 'teacher');
  const results = await Promise.all([a.enqueueOperation(operation('PRESENT')), b.enqueueOperation(operation('PRESENT'))]);
  assert.equal(results[0].operationId, results[1].operationId);
  assert.equal(d.stores.events.size, 1);
  assert.equal((await a.inspect('shared-event-id')).payload.marks[0].status, 'PRESENT');
});
test('concurrent different payloads with one ID cannot overwrite the first capture', async () => {
  const d = device(), a = d.tab('school', 'teacher'), b = d.tab('school', 'teacher');
  const results = await Promise.allSettled([a.enqueueOperation(operation('PRESENT')), b.enqueueOperation(operation('ABSENT'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /reused for different/);
  assert.equal(d.stores.events.size, 1);
  const expected = results[0].status === 'fulfilled' ? 'PRESENT' : 'ABSENT';
  assert.equal((await a.inspect('shared-event-id')).payload.marks[0].status, expected);
});
test('concurrent cross-school collision does not transfer or overwrite ownership', async () => {
  const d = device(), a = d.tab('school-a', 'teacher'), b = d.tab('school-b', 'teacher');
  const results = await Promise.allSettled([a.enqueueOperation(operation('PRESENT')), b.enqueueOperation(operation('ABSENT'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /another account/);
  assert.equal(d.stores.events.size, 1);
  const [winner, loser] = results[0].status === 'fulfilled' ? [a,b] : [b,a];
  assert.equal((await winner.pending()).length, 1);
  assert.equal((await loser.pending()).length, 0);
  await assert.rejects(loser.inspect('shared-event-id'), /not available/);
});

// Storage failures must not be interpreted as an empty successful queue.
test('queue read failure rejects snapshot and does not erase captured records', async () => {
  const d = device(), a = d.tab('school', 'teacher');
  // Two reads release the deliberate shared-ID test barrier.
  await Promise.all([a.enqueueOperation(operation('PRESENT')), a.enqueueOperation(operation('PRESENT'))]);
  assert.equal(d.stores.events.size, 1);
  d.failStorage();
  await assert.rejects(a.snapshot(), /Storage unavailable/);
  d.reconnect();
  await a.sync();
  const status = d.statuses.at(-1);
  assert.equal(status.storageUnavailable, true);
  assert.equal(status.pending, null);
  assert.equal(status.waiting, null);
  assert.equal(status.needsReview, null);
  assert.match(status.syncMessage, /Do not clear browser data/);
  assert.equal(d.stores.events.size, 1);
});
