-- Additive, school-scoped intake for device-captured gate observations.
-- These are NOT attendance_events, staff_attendance_events or DTR entries.
-- Untrusted device time never becomes an official gate timestamp.
CREATE TABLE IF NOT EXISTS offline_gate_observations (
 event_id UUID PRIMARY KEY,
 school_id UUID NOT NULL,
 gatekeeper_user_id UUID NOT NULL,
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('STUDENT','STAFF')),
 subject_reference TEXT,
 badge_sha256 CHAR(64) NOT NULL,
 captured_at_device TIMESTAMPTZ NOT NULL,
 received_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED'
   CHECK(status IN ('REVIEW_REQUIRED','INVALID_BADGE','CLOSED_REVIEWED','DISMISSED')),
 reason TEXT NOT NULL,
 reviewed_by_user_id UUID,
 reviewed_at TIMESTAMPTZ,
 review_note TEXT,
 CONSTRAINT offline_gate_observer_fk FOREIGN KEY (school_id,gatekeeper_user_id)
   REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT offline_gate_reviewer_fk FOREIGN KEY (school_id,reviewed_by_user_id)
   REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS offline_gate_observations_school_queue_idx
 ON offline_gate_observations(school_id,status,received_at_server DESC);
CREATE INDEX IF NOT EXISTS offline_gate_observations_gatekeeper_idx
 ON offline_gate_observations(school_id,gatekeeper_user_id,received_at_server DESC);
COMMENT ON TABLE offline_gate_observations IS
 'Unverified offline Gatekeeper observations awaiting authorized review. Never official attendance or staff Form 48 DTR.';
