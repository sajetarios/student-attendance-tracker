-- Cloud master-data replication and non-login staff mirrors.
-- Apply on both local and cloud databases after migration 013.

ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE school_cloud_sync_settings
  ADD COLUMN IF NOT EXISTS last_master_data_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_master_data_sync_counts JSONB,
  ADD COLUMN IF NOT EXISTS last_master_data_sync_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_master_data_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_master_data_sync_url TEXT;

-- A pre-existing attendance destination has not necessarily been provisioned. Pause it until
-- a current connection test and master-data snapshot have completed after this release.
UPDATE school_cloud_sync_settings SET enabled=FALSE WHERE enabled=TRUE;

CREATE TABLE IF NOT EXISTS cloud_sync_master_data_receipts (
  school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  source_generated_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_hash TEXT NOT NULL,
  record_counts JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS cloud_sync_master_data_receipts_received_idx
  ON cloud_sync_master_data_receipts(received_at DESC);

COMMENT ON COLUMN school_users.login_enabled IS
  'False for server-to-server mirrored staff identities. These rows exist for foreign-key integrity but cannot authenticate interactively.';
COMMENT ON TABLE cloud_sync_master_data_receipts IS
  'Latest idempotent master-data snapshot received from the local school server. Imports never delete cloud records.';
