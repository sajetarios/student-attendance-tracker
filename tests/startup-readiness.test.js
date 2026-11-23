'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerStartupReadinessRoute } = require('../startup-readiness-route');

function simulate({ origin = 'https://attendigo-welcome-preview.onrender.com', query = async () => ({ rows: [{ '?column?': 1 }] }), migrationReadOnly = false } = {}) {
  let handler;
  const app = { get(path, fn) { assert.equal(path, '/api/startup-readiness'); handler = fn; } };
  registerStartupReadinessRoute(app, { query }, { migrationReadOnly, logger: { warn() {} } });
  const headers = {};
  const res = {
    statusCode: 200, body: null,
    set(key, value) { headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return handler({ get(name) { return name.toLowerCase() === 'origin' ? origin : undefined; } }, res).then(() => ({ headers, res }));
}
test('only the approved static welcome origin may read a ready response', async () => {
  const { headers, res } = await simulate();
  assert.deepEqual(res.body, { ready: true, service: 'attendigo' });
  assert.equal(res.statusCode, 200);
  assert.equal(headers['access-control-allow-origin'], 'https://attendigo-welcome-preview.onrender.com');
  assert.equal(headers['access-control-allow-credentials'], undefined);
  assert.equal(headers['cache-control'], 'no-store, private');
});
test('other origins do not receive a readable cross-origin response', async () => {
  const { headers, res } = await simulate({ origin: 'https://example.org' });
  assert.equal(res.statusCode, 200);
  assert.equal(headers['access-control-allow-origin'], undefined);
  assert.equal(headers['vary'], 'Origin');
});
test('database outage keeps welcome on the waiting screen without leaking DB errors', async () => {
  const { res } = await simulate({ query: async () => { throw new Error('secret-db-host:5432 / private'); } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ready: false, service: 'attendigo' });
  assert.doesNotMatch(JSON.stringify(res.body), /secret-db-host|private/);
});
test('maintenance state never signals readiness', async () => {
  const { res } = await simulate({ migrationReadOnly: true });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ready: false, service: 'attendigo' });
});
