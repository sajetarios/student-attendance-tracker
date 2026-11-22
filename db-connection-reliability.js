'use strict';

// The production Supabase session pooler has reported a 15-session ceiling.
// Keep this app's connection budget small enough for a rolling deployment,
// a read-only preflight, and separate maintenance connections.
// No retry of attendance writes here: retrying after an uncertain COMMIT
// could duplicate an attendance event.
const SUPABASE_APP_POOL_MAX = 4;
const SUPABASE_CONNECT_TIMEOUT_MS = 8000;
const SUPABASE_IDLE_TIMEOUT_MS = 10000;

function primaryPoolOptions(base, { supabasePrimary = false } = {}) {
  if (!base || typeof base !== 'object') throw new TypeError('Database pool options are required');
  if (!supabasePrimary) return { ...base };
  return {
    ...base,
    max: SUPABASE_APP_POOL_MAX,
    connectionTimeoutMillis: SUPABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: SUPABASE_IDLE_TIMEOUT_MS,
    keepAlive: true
  };
}

function diagnosticCode(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z0-9_]{2,64}$/.test(code) ? code : 'UNCLASSIFIED';
}

function handleIdleClientErrors(pool, logger = console) {
  if (!pool || typeof pool.on !== 'function') {
    throw new TypeError('A PostgreSQL pool event emitter is required');
  }
  // pg emits 'error' when an idle connection is interrupted by the server.
  // Without a listener Node can crash the whole service. pg automatically
  // removes the faulty client; a later query can establish a fresh one.
  pool.on('error', error => {
    logger.error('[Database] idle_client_error code=' + diagnosticCode(error));
  });
  return pool;
}

function singleFlight(task) {
  if (typeof task !== 'function') throw new TypeError('A job function is required');
  let inFlight = null;
  return function run() {
    if (inFlight) return inFlight;
    const result = Promise.resolve().then(task);
    inFlight = result;
    result.then(
      () => { if (inFlight === result) inFlight = null; },
      () => { if (inFlight === result) inFlight = null; }
    );
    return result;
  };
}

function createDatabaseReadiness(pool, logger = console) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool query function is required');
  }
  return async function databaseReadiness(_req, res) {
    res.set('Cache-Control', 'no-store, private');
    try {
      await pool.query({ text: 'SELECT 1', query_timeout: 5000 });
      return res.status(200).json({
        ok: true, service: 'school-attendance', database: 'reachable'
      });
    } catch (error) {
      // Never expose SQL errors, database hosts, credentials, or account details.
      logger.error('Readiness DB probe failed:', diagnosticCode(error));
      return res.status(503).json({
        ok: false, service: 'school-attendance', database: 'unavailable'
      });
    }
  };
}

module.exports = {
  primaryPoolOptions, diagnosticCode, handleIdleClientErrors,
  singleFlight, createDatabaseReadiness, SUPABASE_APP_POOL_MAX
};
