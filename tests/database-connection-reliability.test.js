'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const {
  primaryPoolOptions, diagnosticCode, handleIdleClientErrors,
  singleFlight, createDatabaseReadiness, SUPABASE_APP_POOL_MAX
} = require('../db-connection-reliability');

test('Supabase pool has a conservative bound and timeouts; TLS/target remain untouched', () => {
  const input = {
    connectionString: 'postgres://mock-user:TEST_PASSWORD@localhost/postgres',
    ssl: { rejectUnauthorized: true, ca: 'TEST_ROOT_CA' }
  };
  const pool = primaryPoolOptions(input, { supabasePrimary: true });
  assert.equal(pool.max, 4);
  assert.equal(SUPABASE_APP_POOL_MAX, 4);
  assert.equal(pool.connectionTimeoutMillis, 8000);
  assert.equal(pool.idleTimeoutMillis, 10000);
  assert.equal(pool.keepAlive, true);
  assert.equal(pool.connectionString, input.connectionString);
  assert.equal(pool.ssl, input.ssl);
  assert.equal(input.max, undefined, 'Original config must not be mutated');
  assert.equal(primaryPoolOptions(input).max, undefined, 'Render fallback stays unchanged');
});

test('Idle PostgreSQL disconnects are safely observed without leaking credentials', () => {
  const pool = new EventEmitter();
  const output = [];
  assert.equal(handleIdleClientErrors(pool, { error: msg => output.push(msg) }), pool);
  pool.emit('error', Object.assign(new Error('password is TEST_PASSWORD'), { code: '57P01' }));
  pool.emit('error', new Error('Connection failed: TEST_PASSWORD'));
  assert.deepEqual(output, [
    '[Database] idle_client_error code=57P01',
    '[Database] idle_client_error code=UNCLASSIFIED'
  ]);
  assert.equal(diagnosticCode({ code: 'evil SECRET\npassword' }), 'UNCLASSIFIED');
});

test('Teacher return / cloud sync jobs do not overlap and can run again after completion', async () => {
  let runs = 0, release;
  const deferred = new Promise(resolve => { release = resolve; });
  const run = singleFlight(async () => { runs++; await deferred; return 'ok'; });
  const first = run();
  const second = run();
  assert.equal(first, second);
  assert.equal(await Promise.resolve().then(() => runs), 1);
  release();
  assert.equal(await first, 'ok');
  assert.equal(await run(), 'ok');
  assert.equal(runs, 2);
});

test('Failed background job releases single-flight guard for next scheduled retry', async () => {
  let calls = 0;
  const job = singleFlight(async () => {
    calls++;
    if (calls === 1) throw new Error('Temporary database interruption');
    return 42;
  });
  await assert.rejects(job(), /Temporary/);
  assert.equal(await job(), 42);
  assert.equal(calls, 2);
});

function response() {
  let code, payload;
  const headers = {};
  return {
    res: {
      set: (name, value) => { headers[name] = value; },
      status: status => { code = status; return { json: object => { payload = object; return object; } }; }
    },
    result: () => ({ code, payload, headers })
  };
}

test('HTTP readiness succeeds only after an actual database SELECT 1', async () => {
  let seen;
  const handler = createDatabaseReadiness({
    query: async opts => { seen = opts; return { rows: [{ '?column?': 1 }] }; }
  });
  const reply = response();
  await handler({}, reply.res);
  assert.deepEqual(seen, { text: 'SELECT 1', query_timeout: 5000 });
  assert.equal(reply.result().code, 200);
  assert.equal(reply.result().payload.database, 'reachable');
  assert.equal(reply.result().headers['Cache-Control'], 'no-store, private');
});

test('HTTP readiness fails closed with 503 and no database secrets', async () => {
  const logs = [];
  const handler = createDatabaseReadiness({
    query: async () => { throw Object.assign(new Error('TEST_PASSWORD postgres://private-host'), { code: '53300' }); }
  }, { error: (...args) => logs.push(args.join(' ')) });
  const reply = response();
  await handler({}, reply.res);
  assert.equal(reply.result().code, 503);
  assert.deepEqual(reply.result().payload, {
    ok: false, service: 'school-attendance', database: 'unavailable'
  });
  assert.deepEqual(logs, ['Readiness DB probe failed: 53300']);
  assert.doesNotMatch(JSON.stringify(reply.result()), /private-host|TEST_PASSWORD/);
});

test('Server exposes the same safe database-readiness handler at both health endpoints', () => {
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.match(source, /const databaseReadiness = createDatabaseReadiness\(pool\)/);
  assert.match(source, /app\.get\('\/health', databaseReadiness\)/);
  assert.match(source, /app\.get\('\/api\/health', databaseReadiness\)/);
});
