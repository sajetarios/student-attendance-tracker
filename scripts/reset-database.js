'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error(`Refusing to reset database "${databaseName}". The database name must contain the word test.`);
  }
  if (process.env.ALLOW_TEST_DB_RESET !== 'YES' || process.env.CONFIRM_DATABASE_RESET !== databaseName) {
    throw new Error(
      `Reset blocked. For a disposable test database only, set ALLOW_TEST_DB_RESET=YES and CONFIRM_DATABASE_RESET=${databaseName} in the current PowerShell session.`
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('SELECT current_database() AS database_name');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public AUTHORIZATION CURRENT_USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    console.log(`Reset public schema in test database: ${databaseName}`);
    const result = await runMigrations(pool);
    console.log(`Fresh test database is ready. ${result.applied.length} migration(s) applied.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
