'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const REQUIRED_MIGRATIONS = [
  '001_core_multischool.sql',
  '002_authentication_foundation.sql',
  '003_teacher_management_and_devices.sql',
  '004_parent_management.sql',
  '005_roles_and_class_advisers.sql',
  '006_sf2_submission_workflow.sql',
  '007_student_portal_accounts.sql',
  '008_teacher_gate_attendance.sql',
  '009_advisory_attendance.sql',
  '010_school_year_enrollment_and_movements.sql',
  '011_special_programs.sql',
  '012_cloud_sync_settings.sql',
  '013_departments_and_classroom_assignment.sql'
];

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function stripTransactionWrappers(sql) {
  return sql
    .replace(/^\s*BEGIN\s*;\s*$/im, '')
    .replace(/^\s*COMMIT\s*;\s*$/im, '')
    .trim();
}

async function runMigrations(pool, logger = console) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .sort();

  const missing = REQUIRED_MIGRATIONS.filter(name => !files.includes(name));
  if (missing.length) {
    throw new Error(`Migration set is incomplete. Missing: ${missing.join(', ')}`);
  }
  const unexpectedOrder = REQUIRED_MIGRATIONS.filter((name, index) => files[index] !== name);
  if (unexpectedOrder.length || files.length !== REQUIRED_MIGRATIONS.length) {
    throw new Error(`Unexpected migration files/order. Expected: ${REQUIRED_MIGRATIONS.join(', ')}`);
  }

  const applied = [];
  for (const name of REQUIRED_MIGRATIONS) {
    const raw = await fs.readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    const hash = checksum(raw);
    const existing = await pool.query(
      'SELECT checksum FROM schema_migrations WHERE migration_name=$1', [name]
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== hash) {
        throw new Error(`Checksum mismatch for ${name}. Do not edit an applied migration; create a new migration instead.`);
      }
      logger.log?.(`Already applied: ${name}`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(stripTransactionWrappers(raw));
      await client.query(
        'INSERT INTO schema_migrations(migration_name, checksum) VALUES($1,$2)',
        [name, hash]
      );
      await client.query('COMMIT');
      applied.push(name);
      logger.log?.(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      error.message = `Migration ${name} failed: ${error.message}`;
      throw error;
    } finally {
      client.release();
    }
  }
  return { applied, total: REQUIRED_MIGRATIONS.length };
}

module.exports = { runMigrations, REQUIRED_MIGRATIONS, stripTransactionWrappers };
