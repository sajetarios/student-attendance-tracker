'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectTarget, runSupabasePreflight } = require('../scripts/supabase-connection-preflight');

const sessionUri = 'postgresql://postgres.phnsdwinavsvhfuwltkw:TEST_SECRET@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';

test('Supabase preflight rejects unset, malformed, wrong-project and transaction-pooler connection strings', () => {
  assert.deepEqual(inspectTarget(), { status: 'not_configured' });
  assert.equal(inspectTarget('not a URI').status, 'invalid_target');
  assert.equal(inspectTarget(sessionUri.replace('phnsdwinavsvhfuwltkw', 'wrongproject')).status, 'invalid_target');
  assert.equal(inspectTarget(sessionUri.replace(':5432/', ':6543/')).status, 'invalid_target');
  assert.deepEqual(inspectTarget(sessionUri), { status: 'configured', method: 'session_pooler' });
});

test('Supabase preflight queries target in read-only mode and leaves primary database untouched', async () => {
  let query;
  let ended = false;
  let options;
  const logs = [];
  class TestPool {
    constructor(input) { options = input; }
    async query(text) {
      query = text;
      return { rows: [{ db_name: 'postgres', migrations: 71, schools: 2, students: 28 }] };
    }
    async end() { ended = true; }
  }
  const out = await runSupabasePreflight({
    connectionString: sessionUri,
    PoolClass: TestPool,
    logger: { log: line => logs.push(line), warn: line => logs.push(line) }
  });
  assert.equal(out.status, 'connected');
  assert.equal(ended, true);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.match(query, /^SELECT /);
  assert.doesNotMatch(query, /\b(?:UPDATE|DELETE|INSERT|ALTER|TRUNCATE|DROP)\b/i);
  assert.equal(logs.some(line => line.includes('TEST_SECRET')), false);
});

test('Supabase connection errors never print passwords or detailed connection strings', async () => {
  const logs = [];
  class TestPool {
    async query() {
      const error = new Error('failed to connect with TEST_SECRET');
      error.code = '28P01';
      throw error;
    }
    async end() {}
  }
  const out = await runSupabasePreflight({
    connectionString: sessionUri,
    PoolClass: TestPool,
    logger: { log: line => logs.push(line), warn: line => logs.push(line) }
  });
  assert.deepEqual(out, { status: 'connection_failed', code: '28P01' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0], '[Supabase preflight] connection_failed code=28P01');
});
