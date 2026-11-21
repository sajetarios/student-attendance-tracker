'use strict';

// Opt-in read-only connection check. Never log credentials, connection strings,
// server error messages, personal data, or SQL results containing user records.
const { Pool } = require('pg');
const PROJECT_REF = 'phnsdwinavsvhfuwltkw';
const SESSION_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i;

function inspectTarget(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    return { status: 'not_configured' };
  }
  let uri;
  try {
    uri = new URL(connectionString);
  } catch {
    return { status: 'invalid_target' };
  }
  if (uri.protocol !== 'postgres:' && uri.protocol !== 'postgresql:') {
    return { status: 'invalid_target' };
  }
  if (uri.pathname !== '/postgres' || (uri.port && uri.port !== '5432')) {
    return { status: 'invalid_target' };
  }
  const username = decodeURIComponent(uri.username);
  const isPooler = SESSION_POOLER_HOST.test(uri.hostname) &&
    username.endsWith('.' + PROJECT_REF);
  const isDirect = uri.hostname === 'db.' + PROJECT_REF + '.supabase.co' &&
    username.length > 0;
  if (!isPooler && !isDirect) return { status: 'invalid_target' };
  if (!uri.password) return { status: 'invalid_target' };
  return { status: 'configured', method: isPooler ? 'session_pooler' : 'direct' };
}

async function runSupabasePreflight({
  connectionString = process.env.SUPABASE_DATABASE_URL,
  PoolClass = Pool,
  logger = console
} = {}) {
  const target = inspectTarget(connectionString);
  if (target.status !== 'configured') {
    logger.warn('[Supabase preflight] ' + target.status);
    return { status: target.status };
  }
  let targetPool;
  try {
    targetPool = new PoolClass({
      connectionString,
      connectionTimeoutMillis: 6500,
      idleTimeoutMillis: 1000,
      max: 1,
      ssl: { rejectUnauthorized: true }
    });
    // The query must remain read-only. No DTR, student, school, or login changes.
    const result = await targetPool.query(
      'SELECT current_database() AS db_name, ' +
      '(SELECT count(*)::int FROM public.schema_migrations) AS migrations, ' +
      '(SELECT count(*)::int FROM public.schools) AS schools, ' +
      '(SELECT count(*)::int FROM public.students) AS students'
    );
    const row = result.rows?.[0];
    if (row?.db_name !== 'postgres' || !Number.isInteger(row.migrations)) {
      logger.warn('[Supabase preflight] target_schema_unavailable');
      return { status: 'target_schema_unavailable' };
    }
    logger.log(
      '[Supabase preflight] connected method=' + target.method +
      ' migrations=' + row.migrations +
      ' schools=' + row.schools +
      ' students=' + row.students
    );
    return { status: 'connected', method: target.method, migrations: row.migrations };
  } catch (error) {
    // Safe diagnostic codes only; error.message might include a credential.
    const code = /^[A-Z0-9]{2,24}$/.test(error?.code || '') ?
      error.code : 'UNCLASSIFIED';
    logger.warn('[Supabase preflight] connection_failed code=' + code);
    return { status: 'connection_failed', code };
  } finally {
    if (targetPool) {
      await targetPool.end().catch(() => {});
    }
  }
}

module.exports = { inspectTarget, runSupabasePreflight };
