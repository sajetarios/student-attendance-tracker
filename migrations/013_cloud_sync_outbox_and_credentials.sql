-- Cloud synchronization foundation. Existing attendance records are retained.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_events_school_event_uk
  ON attendance_events (school_id, event_id);

ALTER TABLE school_cloud_sync_settings
  ADD COLUMN IF NOT EXISTS cloud_auth_token_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS cloud_auth_token_iv BYTEA,
  ADD COLUMN IF NOT EXISTS cloud_auth_token_tag BYTEA,
  ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_connection_test_url TEXT;

CREATE TABLE IF NOT EXISTS cloud_sync_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Local attendance server',
  created_by_user_id UUID,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (school_id, created_by_user_id)
    REFERENCES school_users(school_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cloud_sync_credentials_one_active_per_school
  ON cloud_sync_credentials (school_id)
  WHERE active = TRUE AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS cloud_sync_credentials_school_idx
  ON cloud_sync_credentials (school_id, active, revoked_at);

CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
  sync_id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL,
  event_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SYNCED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  remote_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cloud_sync_outbox_event_uk UNIQUE (school_id, event_id),
  CONSTRAINT cloud_sync_outbox_event_fk
    FOREIGN KEY (school_id, event_id)
    REFERENCES attendance_events(school_id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cloud_sync_outbox_pending_idx
  ON cloud_sync_outbox (school_id, status, next_attempt_at, sync_id);

COMMENT ON TABLE cloud_sync_credentials IS
  'Stores only SHA-256 hashes of one-time-issued server-to-server bearer credentials.';
COMMENT ON TABLE cloud_sync_outbox IS
  'Retry-safe local-to-cloud attendance replication queue. Source attendance rows remain authoritative.';
COMMENT ON COLUMN school_cloud_sync_settings.cloud_auth_token_ciphertext IS
  'AES-256-GCM encrypted outbound credential; encryption key is held only in server environment.';
