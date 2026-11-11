-- Teacher gate identity and attendance.
-- Additive migration: does not alter learner attendance history or teacher schedules.

ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS teacher_qr_token UUID,
  ADD COLUMN IF NOT EXISTS teacher_photo_path TEXT;

UPDATE school_users
SET teacher_qr_token = gen_random_uuid()
WHERE role = 'TEACHER' AND teacher_qr_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS school_users_teacher_qr_token_uk
  ON school_users (school_id, teacher_qr_token)
  WHERE role = 'TEACHER' AND teacher_qr_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS teacher_gate_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  teacher_user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('TIME_IN','TIME_OUT')),
  occurred_at TIMESTAMPTZ NOT NULL,
  school_date DATE NOT NULL,
  recorded_by_user_id UUID NOT NULL,
  photo_verified BOOLEAN NOT NULL DEFAULT FALSE CHECK (photo_verified = TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_gate_event_teacher_fk
    FOREIGN KEY (school_id, teacher_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE,
  CONSTRAINT teacher_gate_event_gatekeeper_fk
    FOREIGN KEY (school_id, recorded_by_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS teacher_gate_one_event_per_type_day_uk
  ON teacher_gate_events (school_id, teacher_user_id, school_date, event_type);
CREATE INDEX IF NOT EXISTS teacher_gate_events_school_date_idx
  ON teacher_gate_events (school_id, school_date, occurred_at DESC);
CREATE INDEX IF NOT EXISTS teacher_gate_events_recorded_by_idx
  ON teacher_gate_events (school_id, recorded_by_user_id, school_date);

COMMENT ON TABLE teacher_gate_events IS
  'Gate Keeper verified teacher time-in/time-out records, separate from learner attendance events.';
COMMENT ON COLUMN school_users.teacher_qr_token IS
  'Opaque private QR token used only for teacher entrance identity lookup.';
COMMENT ON COLUMN school_users.teacher_photo_path IS
  'Private teacher photo path for Gate Keeper identity verification; stored outside public assets.';
