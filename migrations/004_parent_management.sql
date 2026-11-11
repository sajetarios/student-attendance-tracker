-- Parent Management migration for the isolated TEST database only.
-- Target database: school_attendance_backup_test
-- This migration adds parent accounts and verified parent-child links.
-- It does not delete or rewrite students or attendance_events.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fail early with a clear message if this is not the expected multi-school schema.
DO $$
BEGIN
  IF to_regclass('public.school_users') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.schools') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.user_sessions') IS NULL THEN
    RAISE EXCEPTION 'Parent migration stopped: required multi-school/authentication tables are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.school_users'::regclass
      AND conname='school_users_school_user_uk'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'Parent migration stopped: school_users_school_user_uk is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.students'::regclass
      AND conname='students_school_student_uk'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'Parent migration stopped: students_school_student_uk is missing.';
  END IF;
END $$;

ALTER TABLE school_users ADD COLUMN IF NOT EXISTS mobile TEXT;

-- Replace the existing two-role constraint with one that also permits parents.
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_role_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_role_check
  CHECK (role = ANY (ARRAY['SCHOOL_ADMIN'::text, 'TEACHER'::text, 'PARENT'::text]));

CREATE TABLE IF NOT EXISTS parent_student_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  parent_user_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by UUID NULL,
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parent_student_links_status_check
    CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'REVOKED'::text])),
  CONSTRAINT parent_student_links_parent_fk
    FOREIGN KEY (school_id, parent_user_id) REFERENCES school_users(school_id, user_id),
  CONSTRAINT parent_student_links_student_fk
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, student_id),
  CONSTRAINT parent_student_links_approver_fk
    FOREIGN KEY (school_id, approved_by) REFERENCES school_users(school_id, user_id),
  CONSTRAINT parent_student_links_unique
    UNIQUE (school_id, parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS parent_student_links_parent_status_idx
  ON parent_student_links(school_id, parent_user_id, status);
CREATE INDEX IF NOT EXISTS parent_student_links_student_idx
  ON parent_student_links(school_id, student_id, status);
