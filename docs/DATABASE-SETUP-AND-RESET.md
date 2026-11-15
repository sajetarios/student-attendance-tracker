# Database setup and reset guide — v0.8.0

For the current project, follow `docs/INSTALL-V0.8.0.md` to upgrade the existing `school_attendance_backup_test` database. The normal update command is `npm.cmd run db:migrate`; it must not erase existing test data.

## Existing upgraded test database

Your test database previously completed the v0.7.3 adoption flow and has migrations 001–006 recorded in `schema_migrations`. v0.8.0 adds migration `007_student_portal_accounts.sql` for optional learner logins and separate student sessions.

From the new v0.8.0 project folder, after copying `.env` from the last working version:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run db:migrate
```

Expected migration behavior: migrations 001–006 are reported as already applied, and migration 007 is applied once. Do not run `db:adopt-existing-test` again and do not use `db:reset:test` for this update.

## Fresh empty test database

1. Create a genuinely empty PostgreSQL database whose name includes `test`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to that database.
3. Run `npm.cmd install`, then `npm.cmd run db:migrate`.
4. Create a school and the first School Administrator using the commands in the project README.

## Destructive test reset

`npm.cmd run db:reset:test` drops and recreates the `public` schema, including all tables and test data. Use it only when the database is definitely disposable and must be rebuilt from scratch.

```powershell
$env:ALLOW_TEST_DB_RESET = "YES"
$env:CONFIRM_DATABASE_RESET = "YOUR_EXACT_TEST_DATABASE_NAME"
npm.cmd run db:reset:test
Remove-Item Env:ALLOW_TEST_DB_RESET
Remove-Item Env:CONFIRM_DATABASE_RESET
```

The exact database name in the confirmation variable must match the database in `DATABASE_URL`. Do not run this command against a live or production database.

## Migration inventory

| Migration | Purpose |
|---|---|
| `001_core_multischool.sql` | School tenants, user base tables, learners, class schedules, attendance, devices, settings and SMS outbox |
| `002_authentication_foundation.sql` | Login lockout/session fields, school sessions, teacher-period assignments and audit log |
| `003_teacher_management_and_devices.sql` | Teacher leave state, substitute coverage and hashed device credentials |
| `004_parent_management.sql` | Parent-to-learner relationships |
| `005_roles_and_class_advisers.sql` | Department Head/Gate Keeper roles, teacher designations and Class Adviser section assignments |
| `006_sf2_submission_workflow.sql` | Learner sex classification, confirmed absence overrides and official SF2 submissions |
| `007_student_portal_accounts.sql` | Optional learner login accounts and separate student sessions |

The runner stores migration names and SHA-256 checksums in `schema_migrations`. Do not edit an already-applied migration; create a new numbered migration instead.
