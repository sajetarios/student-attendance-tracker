-- Teacher leave/substitute coverage and authenticated device credentials.

ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS teacher_status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS leave_type TEXT,
  ADD COLUMN IF NOT EXISTS leave_start_date DATE,
  ADD COLUMN IF NOT EXISTS expected_return_date DATE,
  ADD COLUMN IF NOT EXISTS leave_auto_reactivate BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_teacher_status_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_teacher_status_check
  CHECK (teacher_status IN ('ACTIVE','INACTIVE','ON_LEAVE'));
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_leave_type_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_leave_type_check
  CHECK (leave_type IS NULL OR leave_type IN ('MATERNITY','SICK','VACATION','PERSONAL','OTHER'));
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_leave_dates_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_leave_dates_check
  CHECK (
    (leave_start_date IS NULL AND expected_return_date IS NULL)
    OR (leave_start_date IS NOT NULL AND expected_return_date IS NOT NULL
        AND expected_return_date >= leave_start_date)
  );
CREATE INDEX IF NOT EXISTS school_users_teacher_leave_due_idx
  ON school_users (expected_return_date)
  WHERE role='TEACHER' AND teacher_status='ON_LEAVE' AND leave_auto_reactivate=TRUE;

CREATE TABLE IF NOT EXISTS teacher_period_substitutions (
  substitution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  period_id UUID NOT NULL,
  original_teacher_user_id UUID NOT NULL,
  substitute_teacher_user_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT teacher_substitution_dates_check CHECK (end_date >= start_date),
  CONSTRAINT teacher_substitution_different_teachers_check CHECK (original_teacher_user_id <> substitute_teacher_user_id),
  CONSTRAINT teacher_substitution_period_fk
    FOREIGN KEY (school_id, period_id)
    REFERENCES class_periods(school_id, period_id) ON DELETE CASCADE,
  CONSTRAINT teacher_substitution_original_fk
    FOREIGN KEY (school_id, original_teacher_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE,
  CONSTRAINT teacher_substitution_substitute_fk
    FOREIGN KEY (school_id, substitute_teacher_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE,
  CONSTRAINT teacher_substitution_created_by_fk
    FOREIGN KEY (school_id, created_by_user_id)
    REFERENCES school_users(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS teacher_substitutions_active_dates_idx
  ON teacher_period_substitutions (school_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS teacher_substitutions_substitute_idx
  ON teacher_period_substitutions (school_id, substitute_teacher_user_id, status);
CREATE INDEX IF NOT EXISTS teacher_substitutions_original_idx
  ON teacher_period_substitutions (school_id, original_teacher_user_id, status);

CREATE TABLE IF NOT EXISTS device_api_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT device_api_credentials_device_fk
    FOREIGN KEY (school_id, device_id)
    REFERENCES attendance_devices(school_id, device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS device_api_credentials_active_idx
  ON device_api_credentials (school_id, device_id)
  WHERE active=TRUE AND revoked_at IS NULL;

COMMENT ON TABLE teacher_period_substitutions IS
  'Date-limited substitute coverage. Permanent teacher-period assignments are preserved.';
COMMENT ON TABLE device_api_credentials IS
  'Stores only SHA-256 hashes of opaque device bearer tokens.';
