-- Per-school cloud destination settings. Credentials are deliberately not stored here.
CREATE TABLE IF NOT EXISTS school_cloud_sync_settings (
  school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
  cloud_base_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, updated_by_user_id) REFERENCES school_users(school_id, user_id),
  CHECK (cloud_base_url IS NULL OR length(cloud_base_url) <= 500)
);
