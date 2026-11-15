-- Super Admin-issued recovery codes are single-use and target only School Admin accounts.
CREATE TABLE IF NOT EXISTS school_admin_recovery_codes (
  recovery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  school_user_id UUID NOT NULL,
  issued_by_platform_user_id UUID NOT NULL REFERENCES platform_users(user_id),
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT recovery_school_user_fk FOREIGN KEY (school_id, school_user_id)
    REFERENCES school_users(school_id,user_id) ON DELETE CASCADE,
  CONSTRAINT recovery_expiration_valid CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS recovery_current_target_idx
  ON school_admin_recovery_codes (school_id,school_user_id,expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
