'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { runMigrations, REQUIRED_MIGRATIONS } = require('./migrate');

const BASELINE_MIGRATIONS = REQUIRED_MIGRATIONS.filter(name => name !== '005_roles_and_class_advisers.sql');
const REQUIRED_COLUMNS = {
  schools: ['school_id', 'school_code', 'school_name', 'active'],
  platform_users: ['user_id', 'username', 'display_name', 'password_hash', 'active', 'failed_login_attempts', 'locked_until', 'last_login_at', 'session_version'],
  school_users: ['user_id', 'school_id', 'username', 'display_name', 'password_hash', 'role', 'active', 'mobile', 'failed_login_attempts', 'locked_until', 'last_login_at', 'session_version', 'teacher_status', 'leave_type', 'leave_start_date', 'expected_return_date', 'leave_auto_reactivate'],
  students: ['school_id', 'student_id', 'lrn', 'full_name', 'grade_level', 'section', 'parent_mobile', 'active', 'sex'],
  class_periods: ['period_id', 'school_id', 'period_name', 'grade_level', 'section', 'subject_name', 'start_time', 'end_time', 'grace_minutes', 'active'],
  attendance_devices: ['device_id', 'school_id', 'device_name', 'entrance_name', 'active'],
  attendance_events: ['event_id', 'school_id', 'device_id', 'student_id', 'attendance_scope', 'period_id', 'event_type', 'occurred_at_device', 'received_at_server', 'school_date', 'late', 'sync_status', 'recorded_by_user_id'],
  sms_outbox: ['id', 'event_id', 'recipient', 'message', 'status', 'attempts', 'created_at'],
  school_settings: ['school_id', 'setting_key', 'setting_value'],
  user_sessions: ['session_id', 'token_hash', 'principal_type', 'school_id', 'school_user_id', 'platform_user_id', 'created_at', 'expires_at'],
  teacher_period_assignments: ['assignment_id', 'school_id', 'teacher_user_id', 'period_id', 'assigned_at'],
  audit_logs: ['audit_id', 'school_id', 'actor_type', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'details', 'created_at'],
  teacher_period_substitutions: ['substitution_id', 'school_id', 'period_id', 'original_teacher_user_id', 'substitute_teacher_user_id', 'start_date', 'end_date', 'status', 'created_by_user_id', 'created_at'],
  device_api_credentials: ['credential_id', 'school_id', 'device_id', 'device_name', 'token_hash', 'active', 'created_at'],
  parent_student_links: ['link_id', 'school_id', 'parent_user_id', 'student_id', 'relationship', 'status', 'approved_by', 'approved_at', 'created_at', 'updated_at'],
  sf2_daily_overrides: ['school_id', 'student_id', 'school_date', 'status', 'absence_type', 'note', 'recorded_by_user_id', 'created_at'],
  sf2_submissions: ['submission_id', 'school_id', 'reporting_month', 'grade_level', 'section', 'revision', 'status', 'is_current', 'file_name', 'file_path', 'submitted_by_user_id', 'submitted_at', 'collected_by_user_id', 'collected_at', 'summary']
};

const REQUIRED_CONSTRAINTS = [
  ['school_users', 'school_users_school_user_uk'],
  ['students', 'students_school_student_uk']
];
const REQUIRED_INDEXES = [
  ['sf2_submissions', 'sf2_submissions_current_section_month_idx']
];

function checksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function assertAdoptableTestDatabase(client) {
  const dbResult = await client.query('SELECT current_database() AS name');
  const databaseName = dbResult.rows[0]?.name || '';
  if (!/test/i.test(databaseName)) {
    throw new Error(`Safety stop: database "${databaseName}" does not contain "test" in its name. This adoption command only runs against a test database.`);
  }

  const newColumn = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='school_users' AND column_name='teacher_designations'
    ) AS exists
  `);
  const newTable = await client.query(`SELECT to_regclass('public.class_adviser_assignments') IS NOT NULL AS exists`);
  if (newColumn.rows[0].exists || newTable.rows[0].exists) {
    throw new Error('Safety stop: the role/designation migration appears to be already or partially applied. Do not adopt the baseline; inspect schema_migrations and the existing adviser structures first.');
  }

  const columnResult = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
  `);
  const columnsByTable = new Map();
  for (const row of columnResult.rows) {
    if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
    columnsByTable.get(row.table_name).add(row.column_name);
  }
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const found = columnsByTable.get(table);
    if (!found) {
      missing.push(`${table} (table missing)`);
      continue;
    }
    for (const column of columns) if (!found.has(column)) missing.push(`${table}.${column}`);
  }
  if (missing.length) {
    throw new Error(`Safety stop: this database does not match the expected pre-role schema. Missing: ${missing.join(', ')}. No changes have been made.`);
  }

  const constraintsResult = await client.query(`
    SELECT conrelid::regclass::text AS table_name, conname AS name
    FROM pg_constraint
    WHERE connamespace='public'::regnamespace
  `);
  const constraints = new Set(constraintsResult.rows.map(r => `${r.table_name.split('.').pop().replaceAll('"','')}:${r.name}`));
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(([table, name]) => !constraints.has(`${table}:${name}`));
  if (missingConstraints.length) {
    throw new Error(`Safety stop: required tenant-safe constraints are missing: ${missingConstraints.map(x => x.join('.')).join(', ')}. No changes have been made.`);
  }

  const indexesResult = await client.query(`
    SELECT tablename AS table_name, indexname AS name
    FROM pg_indexes
    WHERE schemaname='public'
  `);
  const indexes = new Set(indexesResult.rows.map(r => `${r.table_name}:${r.name}`));
  const missingIndexes = REQUIRED_INDEXES.filter(([table, name]) => !indexes.has(`${table}:${name}`));
  if (missingIndexes.length) {
    throw new Error(`Safety stop: required SF2 indexes are missing: ${missingIndexes.map(x => x.join('.')).join(', ')}. No changes have been made.`);
  }

  const rolesResult = await client.query('SELECT DISTINCT role FROM school_users ORDER BY role');
  const allowedExistingRoles = new Set(['SCHOOL_ADMIN', 'TEACHER', 'PARENT']);
  const unexpectedRoles = rolesResult.rows.map(r => r.role).filter(role => !allowedExistingRoles.has(role));
  if (unexpectedRoles.length) {
    throw new Error(`Safety stop: unexpected existing school roles found: ${unexpectedRoles.join(', ')}. No changes have been made.`);
  }

  return { databaseName, existingRoles: rolesResult.rows.map(r => r.role) };
}

async function adoptExistingTestDatabase(pool, logger = console) {
  const client = await pool.connect();
  let baselineAdopted = false;
  try {
    await client.query('BEGIN');
    const { databaseName, existingRoles } = await assertAdoptableTestDatabase(client);

    const historyResult = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`);
    if (historyResult.rows[0].exists) {
      const countResult = await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
      if (countResult.rows[0].count > 0) {
        throw new Error('Safety stop: schema_migrations already contains records. Use npm.cmd run db:migrate only after reviewing that history; this adoption command will not overwrite migration history.');
      }
    } else {
      await client.query(`
        CREATE TABLE schema_migrations (
          migration_name TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    }

    const migrationDir = path.join(__dirname, '..', 'migrations');
    for (const name of BASELINE_MIGRATIONS) {
      const content = await fs.readFile(path.join(migrationDir, name), 'utf8');
      await client.query(
        'INSERT INTO schema_migrations(migration_name, checksum) VALUES($1, $2)',
        [name, checksum(content)]
      );
    }
    await client.query('COMMIT');
    baselineAdopted = true;
    logger.log?.(`Verified existing schema in ${databaseName}. Adopted ${BASELINE_MIGRATIONS.length} existing migration baselines; existing role values: ${existingRoles.join(', ') || '(no school users)'}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (baselineAdopted) {
    const result = await runMigrations(pool, logger);
    return { ...result, baselineAdopted: BASELINE_MIGRATIONS.length };
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing. Configure the existing test database in .env first.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await adoptExistingTestDatabase(pool);
    console.log(`Existing test database upgrade complete. ${result.applied.length} new migration(s) applied; ${result.baselineAdopted} existing migrations adopted.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { assertAdoptableTestDatabase, adoptExistingTestDatabase, REQUIRED_COLUMNS, BASELINE_MIGRATIONS, checksum };
