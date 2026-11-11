-- Multi-school attendance platform: authentication foundation
-- Version: 002
-- Apply ONLY after migration 001 has completed successfully.
-- Safe to apply to the TEST database first. This migration creates authentication
-- sessions, username indexes, teacher-to-period assignments, and audit logging.

-- Login lockout and session-version fields support account protection and
-- immediate revocation of existing sessions when an account is disabled.
ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

-- Composite keys are required for tenant-safe foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'school_users_school_user_uk'
      AND conrelid = 'school_users'::regclass
  ) THEN
    ALTER TABLE school_users
      ADD CONSTRAINT school_users_school_user_uk UNIQUE (school_id, user_id);
  END IF;
END $$;

-- Case-insensitive usernames prevent visually identical duplicate accounts.
CREATE UNIQUE INDEX IF NOT EXISTS school_users_school_username_ci_uk
  ON school_users (school_id, lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS platform_users_username_ci_uk
  ON platform_users (lower(username));

-- Opaque random bearer tokens are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS user_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('PLATFORM', 'SCHOOL')),
  school_id UUID,
  school_user_id UUID,
  platform_user_id UUID REFERENCES platform_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (
    (principal_type = 'PLATFORM' AND platform_user_id IS NOT NULL
      AND school_id IS NULL AND school_user_id IS NULL)
    OR
    (principal_type = 'SCHOOL' AND platform_user_id IS NULL
      AND school_id IS NOT NULL AND school_user_id IS NOT NULL)
  ),
  CONSTRAINT user_sessions_school_user_fk
    FOREIGN KEY (school_id, school_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx
  ON user_sessions (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_school_user_idx
  ON user_sessions (school_id, school_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_platform_user_idx
  ON user_sessions (platform_user_id) WHERE revoked_at IS NULL;

-- Teachers are assigned to specific class periods/subjects within their school.
CREATE TABLE IF NOT EXISTS teacher_period_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  teacher_user_id UUID NOT NULL,
  period_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, teacher_user_id, period_id),
  CONSTRAINT teacher_assignment_teacher_fk
    FOREIGN KEY (school_id, teacher_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE,
  CONSTRAINT teacher_assignment_period_fk
    FOREIGN KEY (school_id, period_id)
    REFERENCES class_periods(school_id, period_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS teacher_assignments_by_period_idx
  ON teacher_period_assignments (school_id, period_id);

-- The authenticated teacher/admin responsible for an event can be recorded.
-- Gate devices may continue to create records with a NULL user ID.
ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_events_recorded_by_school_fk'
      AND conrelid = 'attendance_events'::regclass
  ) THEN
    ALTER TABLE attendance_events
      ADD CONSTRAINT attendance_events_recorded_by_school_fk
      FOREIGN KEY (school_id, recorded_by_user_id)
      REFERENCES school_users(school_id, user_id) NOT VALID;
  END IF;
END $$;

ALTER TABLE attendance_events
  VALIDATE CONSTRAINT attendance_events_recorded_by_school_fk;

-- Audit trail for account, configuration, and attendance administration actions.
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGSERIAL PRIMARY KEY,
  school_id UUID REFERENCES schools(school_id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PLATFORM', 'SCHOOL', 'DEVICE', 'SYSTEM')),
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_school_created_idx
  ON audit_logs (school_id, created_at DESC);

COMMENT ON TABLE user_sessions IS
  'Stores SHA-256 hashes of opaque bearer tokens; raw tokens are returned only at login.';
COMMENT ON TABLE teacher_period_assignments IS
  'Maps a teacher account to the class periods/subjects that the teacher may manage.';
COMMENT ON TABLE audit_logs IS
  'Audit trail for privileged actions. Avoid storing passwords, tokens, or parent contact details in details.';

-- Verification after execution:
-- SELECT to_regclass('public.user_sessions'),
--        to_regclass('public.teacher_period_assignments'),
--        to_regclass('public.audit_logs');
-- SELECT COUNT(*) FROM user_sessions;
-- SELECT COUNT(*) FROM teacher_period_assignments;
