'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing. Copy .env.example to .env and configure it.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await runMigrations(pool);
    console.log(`Migration check complete. ${result.applied.length} migration(s) applied; ${result.total} total.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
