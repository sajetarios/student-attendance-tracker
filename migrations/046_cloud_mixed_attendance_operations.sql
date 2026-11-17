-- Typed, durable local-school-server -> cloud attendance synchronization.
-- Migration only adds tables/constraints; existing QR events and attendance remain unchanged.
CREATE TABLE IF NOT EXISTS school_cloud_sync_operations (
  operation_id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('MANUAL_MARKS','REGISTER_SIGNOFF')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','PROCESSING','RETRY','SENT','REVIEW')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE(school_id,operation_id)
);
CREATE INDEX IF NOT EXISTS school_cloud_sync_operations_pending_idx
  ON school_cloud_sync_operations(status,next_attempt_at,created_at)
  WHERE status IN ('PENDING','RETRY');

-- The receiver records applied operations in the same transaction as changes,
-- allowing replays after lost HTTP acknowledgements without duplicate audits.
CREATE TABLE IF NOT EXISTS cloud_sync_operation_receipts (
  operation_id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('MANUAL_MARKS','REGISTER_SIGNOFF')),
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id,operation_id)
);
CREATE INDEX IF NOT EXISTS cloud_sync_operation_receipts_school_idx
  ON cloud_sync_operation_receipts(school_id,applied_at DESC);

-- Existing QR outbox rows are never removed while expanding its state machine.
ALTER TABLE school_cloud_sync_outbox
  DROP CONSTRAINT IF EXISTS school_cloud_sync_outbox_status_check;
ALTER TABLE school_cloud_sync_outbox
  ADD CONSTRAINT school_cloud_sync_outbox_status_check
  CHECK(status IN ('PENDING','PROCESSING','RETRY','SENT','REVIEW'));
