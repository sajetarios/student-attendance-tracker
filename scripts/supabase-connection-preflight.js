'use strict';

// Opt-in read-only connection check. Never log credentials, connection strings,
// server error messages, personal data, or SQL results containing user records.
const https = require('node:https');
const { X509Certificate } = require('node:crypto');
const { Pool } = require('pg');

const PROJECT_REF = 'phnsdwinavsvhfuwltkw';
const SESSION_POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i;
const SUPABASE_ROOT_CA_URL =
  'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt';

function inspectTarget(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    return { status: 'not_configured' };
  }
  let uri;
  try { uri = new URL(connectionString); }
  catch { return { status: 'invalid_target' }; }
  if (uri.protocol !== 'postgres:' && uri.protocol !== 'postgresql:') {
    return { status: 'invalid_target' };
  }
  if (uri.pathname !== '/postgres' || (uri.port && uri.port !== '5432')) {
    return { status: 'invalid_target' };
  }
  const username = uri.username;
  const isPooler = SESSION_POOLER_HOST.test(uri.hostname) &&
    username.endsWith('.' + PROJECT_REF);
  const isDirect = uri.hostname === 'db.' + PROJECT_REF + '.supabase.co' &&
    username.length > 0;
  if (!isPooler && !isDirect) return { status: 'invalid_target' };
  if (!uri.password) return { status: 'invalid_target' };
  return { status: 'configured', method: isPooler ? 'session_pooler' : 'direct' };
}

function validateOfficialRootCa(pem) {
  if (typeof pem !== 'string' || !pem.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Supabase root CA invalid');
  }
  const certificate = new X509Certificate(pem);
  if (!certificate.ca ||
      !certificate.subject.includes('CN=Supabase Root 2021 CA') ||
      certificate.subject !== certificate.issuer ||
      !certificate.verify(certificate.publicKey) ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) < Date.now()) {
    throw new Error('Supabase root CA validation failed');
  }
  return pem;
}

// The certificate is public and fetched over normal, fully verified HTTPS
// from Supabase's published downloads bucket. Never downgrade TLS checks.
async function downloadOfficialRootCa() {
  const pem = await new Promise((resolve, reject) => {
    const req = https.get(SUPABASE_ROOT_CA_URL, { timeout: 7000 }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Supabase CA download unavailable'));
        return;
      }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        data += chunk;
        if (data.length > 10000) {
          response.destroy(new Error('Supabase CA unexpected size'));
        }
      });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Supabase CA download timeout')));
    req.on('error', reject);
  });
  return validateOfficialRootCa(pem);
}

async function runSupabasePreflight({
  connectionString = process.env.SUPABASE_DATABASE_URL,
  PoolClass = Pool,
  logger = console,
  getRootCa = downloadOfficialRootCa
} = {}) {
  const target = inspectTarget(connectionString);
  if (target.status !== 'configured') {
    logger.warn('[Supabase preflight] ' + target.status);
    return { status: target.status };
  }

  let ca;
  try {
    ca = await getRootCa();
  } catch {
    logger.warn('[Supabase preflight] trusted_ca_unavailable');
    return { status: 'trusted_ca_unavailable' };
  }

  // pg-connection-string's sslmode/sslrootcert parser can replace an explicit
  // ssl.ca value. Strip those two parameters and pass a verified CA directly.
  const parsed = new URL(connectionString);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslrootcert');
  let targetPool;
  try {
    targetPool = new PoolClass({
      connectionString: parsed.toString(),
      connectionTimeoutMillis: 6500,
      idleTimeoutMillis: 1000,
      max: 1,
      ssl: { ca, rejectUnauthorized: true }
    });
    // Always read-only. Never modifies attendance, DTR, users or sessions.
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
      '[Supabase preflight] connected tls=verified method=' + target.method +
      ' migrations=' + row.migrations +
      ' schools=' + row.schools +
      ' students=' + row.students
    );
    return { status: 'connected', method: target.method, migrations: row.migrations };
  } catch (error) {
    const code = /^[A-Z0-9_]{2,64}$/.test(error?.code || '') ?
      error.code : 'UNCLASSIFIED';
    const message = typeof error?.message === 'string' ? error.message : '';
    const category = /certificate|self.signed|unable to verify|tls|ssl/i.test(message) ?
      'TLS' : /password|authentication|credentials|tenant|role does not exist/i.test(message) ?
      'AUTH' : /timeout|timed out/i.test(message) ?
      'TIMEOUT' : /getaddrinfo|name resolution|dns/i.test(message) ?
      'DNS' : /permission denied/i.test(message) ?
      'PERMISSIONS' : 'OTHER';
    logger.warn('[Supabase preflight] connection_failed code=' + code + ' category=' + category);
    return { status: 'connection_failed', code };
  } finally {
    if (targetPool) await targetPool.end().catch(() => {});
  }
}

module.exports = { inspectTarget, validateOfficialRootCa, downloadOfficialRootCa, runSupabasePreflight };
