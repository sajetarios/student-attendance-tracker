'use strict';

const { Pool } = require('pg');

// Hosted databases (for example Render's external URL) require TLS. Set PGSSLMODE=require to enable it.
// A connection string that already contains sslmode=... is respected as is.
function sslOption() {
  const url = process.env.DATABASE_URL || '';
  if (/[?&]sslmode=/i.test(url)) return undefined;
  const mode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || '').toLowerCase();
  return ['require', 'true', '1', 'no-verify'].includes(mode) ? { rejectUnauthorized: false } : undefined;
}

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslOption(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  // An idle client dropping its connection must never crash the process.
  pool.on('error', err => console.error('Idle database client error:', err.message));
  return pool;
}

module.exports = { createPool };
