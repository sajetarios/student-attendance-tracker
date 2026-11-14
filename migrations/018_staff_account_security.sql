-- Staff account security controls.
-- Adds forced password rotation after administrator-issued temporary passwords.
ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS user_sessions_active_school_user_idx
  ON user_sessions (school_id, school_user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS school_users_security_lookup_idx
  ON school_users (school_id, role, active, locked_until);
