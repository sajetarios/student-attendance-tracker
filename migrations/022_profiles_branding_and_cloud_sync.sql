-- School-owned identity plus a durable, authenticated cloud attendance outbox.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS brand_color TEXT NOT NULL DEFAULT '#2463a5',
  ADD COLUMN IF NOT EXISTS logo_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schools_brand_color_hex_ck') THEN
    ALTER TABLE schools ADD CONSTRAINT schools_brand_color_hex_ck
      CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

ALTER TABLE school_cloud_sync_settings
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS school_cloud_sync_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES attendance_events(event_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','RETRY','SENT')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, event_id)
);
CREATE INDEX IF NOT EXISTS school_cloud_sync_outbox_pending_idx
  ON school_cloud_sync_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','RETRY');

CREATE TABLE IF NOT EXISTS cloud_sync_nonces (
  nonce TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cloud_sync_nonces_received_idx ON cloud_sync_nonces(received_at);
