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
  '013_departments_and_classroom_assignment.sql',
  '014_student_sex_and_roster_management.sql',
  '015_student_archive_and_batch_management.sql',
  '016_school_subject_catalog.sql',
  '017_demo001_subject_department_correction.sql',
  '018_staff_account_security.sql',
  '019_demo001_grade8_spj_class_adviser.sql',
  '020_configurable_school_timetable.sql',
  '021_calendar_exception_schedule_selection.sql',
  '022_profiles_branding_and_cloud_sync.sql',
  '023_demo001_role_and_sf2_attendance.sql',
  '024_flexible_class_schedule_adjustments.sql',
  '025_school_admin_recovery_codes.sql',
  '026_durable_reviewed_profile_photos.sql',
  '027_platform_admin_profile_photos.sql',
  '028_schedule_qr_attendance.sql',
  '029_guardian_management.sql',
  '030_sms_notifications.sql',
  '031_student_portal_account_requests.sql',
  '032_reconcile_student_account_requests.sql',
  '033_durable_school_logos.sql',
  '034_manual_attendance_marks.sql',
  '035_manual_attendance_notes.sql',
  '036_manual_attendance_audit.sql',
  '037_platform_school_deletion_backups.sql',
  '038_planner_items.sql',
  '039_teacher_position.sql',
  '040_platform_plans.sql',
  '041_school_sections.sql',
  '042_schedule_activity_type.sql',
  '043_sardo_monitoring_followups.sql',
  '044_class_attendance_finalizations.sql',
  '045_manual_attendance_optimistic_lock.sql',
  '046_cloud_mixed_attendance_operations.sql',
  '047_special_program_approvals.sql',
  '048_special_program_request_batches.sql',
  '049_universal_request_notifications.sql',
  '050_student_attendance_pins.sql',
  '051_staff_smart_attendance_foundation.sql',
  '052_staff_lunch_presenter_assignments.sql',
  '053_multi_department_lunch_presenters.sql',
  '054_ob_notification_lifecycle.sql',
  '055_staff_form48_monthly_reviews.sql',
  '056_form48_signatory_positions.sql',
  '057_staff_form48_school_defaults_and_leaves.sql',
  '058_staff_form48_employee_schedules.sql',
  '059_automatic_record_identifiers.sql',
  '060_year_grade_student_ids.sql',
  '061_memorable_student_ids.sql',
  '062_mnchs_pilot_attendance_reset.sql',
  '063_platform_school_deletion_protected_audit.sql',
  '064_offline_gate_observation_review.sql',
  '065_school_section_identity_guard.sql',
  '066_school_shs_levels_and_curriculum.sql',
  '067_sf1_missing_family_profile.sql',
  '068_sf1_family_name_punctuation.sql',
  '069_sf1_family_dash_placeholders.sql',
  '070_verified_mnchs_sf1_name_order.sql',
  '071_structured_student_names.sql',
  '072_durable_sf2_submission_files.sql',
  '073_attendance_review_lookup_indexes.sql',
  '074_deped_leave_vsc_workflow.sql',
  '075_department_optional_for_leave_applicant.sql',
  '076_deped_sick_leave_credit_scheme.sql',
  '077_principal_leadership_role.sql',
  '078_principal_sdo_handoff.sql'
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
      // Previously deployed 076 required both Supabase roles. Its completed
      // schema is compatible with this specific portable revision.
      const compatible076 = name === '076_deped_sick_leave_credit_scheme.sql' &&
        existing.rows[0].checksum === 'ffca3411adce0027cff7fea91dcb0f66c2eeeb0d4770fa8991af57176193e969' &&
        hash === '3d6749caa38b0208c690db01c7e061d2addd1d15b13c4632b3bd66afcdfbed9d';
      if (existing.rows[0].checksum !== hash && !compatible076) {
        throw new Error(`Checksum mismatch for ${name}. Do not edit an applied migration; create a new migration instead.`);
      }
      logger.log?.(`Already applied: ${name}`);
      continue;
    }

    // This one-time data correction applies only to the seeded DEMO001 school.
    // Fresh installations and isolated test databases may not contain that demo
    // tenant yet, so leave the migration pending instead of failing startup.
    if (['017_demo001_subject_department_correction.sql', '019_demo001_grade8_spj_class_adviser.sql', '023_demo001_role_and_sf2_attendance.sql'].includes(name)) {
      const demoSchool = await pool.query(
        "SELECT 1 FROM schools WHERE school_code='DEMO001' AND active=TRUE LIMIT 1"
      );
      if (!demoSchool.rowCount) {
        logger.log?.(`Skipped optional demo-only migration: ${name} (DEMO001 is not present).`);
        continue;
      }
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
