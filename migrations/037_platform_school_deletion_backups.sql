-- Durable, database-held recovery snapshot for two-confirmation Super Admin school deletion.
-- No foreign key to schools: recovery data and the global audit entry survive deletion.
CREATE TABLE IF NOT EXISTS platform_school_deletion_backups (
  backup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  school_code TEXT NOT NULL,
  school_name TEXT NOT NULL,
  deleted_by UUID NOT NULL REFERENCES platform_users(user_id),
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_school_deletion_backups_school_idx
  ON platform_school_deletion_backups(school_id,created_at DESC);
CREATE TABLE IF NOT EXISTS platform_school_deletion_backup_rows (
  row_id BIGSERIAL PRIMARY KEY,
  backup_id UUID NOT NULL REFERENCES platform_school_deletion_backups(backup_id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  row_data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_school_deletion_backup_rows_backup_idx
  ON platform_school_deletion_backup_rows(backup_id,source_table);
