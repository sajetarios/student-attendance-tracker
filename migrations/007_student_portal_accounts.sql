-- Student self-service portal accounts.
-- This migration is additive: existing students, school users, parent links,
-- attendance events and school sessions are preserved.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL OR to_regclass('public.schools') IS NULL THEN
    RAISE EXCEPTION 'Student portal migration stopped: schools and students tables must exist.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.students'::regclass
      AND conname='students_school_student_uk'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'Student portal migration stopped: students_school_student_uk is required.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS student_accounts (
  student_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts BETWEEN 0 AND 5),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_accounts_school_account_uk UNIQUE (school_id, student_account_id),
  CONSTRAINT student_accounts_one_per_student_uk UNIQUE (school_id, student_id),
  CONSTRAINT student_accounts_student_fk
    FOREIGN KEY (school_id, student_id)
    REFERENCES students(school_id, student_id) ON DELETE CASCADE,
  CONSTRAINT student_accounts_username_nonblank
    CHECK (length(trim(username)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_accounts_school_username_ci_uk
  ON student_accounts (school_id, lower(username));
CREATE INDEX IF NOT EXISTS student_accounts_active_idx
  ON student_accounts (school_id, active, student_id);

CREATE TABLE IF NOT EXISTS student_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  school_id UUID NOT NULL,
  student_account_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT student_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT student_sessions_account_fk
    FOREIGN KEY (school_id, student_account_id)
    REFERENCES student_accounts(school_id, student_account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS student_sessions_active_expiry_idx
  ON student_sessions (expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS student_sessions_by_account_idx
  ON student_sessions (school_id, student_account_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE student_accounts IS
  'Optional student self-service portal credentials. Student accounts can access only their own profile and attendance.';
COMMENT ON TABLE student_sessions IS
  'Separate token sessions for student users; they cannot authenticate to school staff or parent APIs.';
