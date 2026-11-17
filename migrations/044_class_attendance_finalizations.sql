-- Teachers explicitly sign off a completed classroom register before adviser review.
-- This does not synthesize a whole-day absence or overwrite SF2 classifications.
CREATE TABLE IF NOT EXISTS class_attendance_finalizations (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  period_id UUID NOT NULL,
  school_date DATE NOT NULL,
  finalized BOOLEAN NOT NULL DEFAULT TRUE,
  roster_count INTEGER NOT NULL DEFAULT 0 CHECK (roster_count >= 0),
  finalized_by_user_id UUID NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopened_by_user_id UUID,
  reopened_at TIMESTAMPTZ,
  PRIMARY KEY (school_id, period_id, school_date),
  FOREIGN KEY (school_id, period_id) REFERENCES class_periods(school_id,period_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, finalized_by_user_id) REFERENCES school_users(school_id,user_id),
  FOREIGN KEY (school_id, reopened_by_user_id) REFERENCES school_users(school_id,user_id)
);
CREATE INDEX IF NOT EXISTS class_attendance_finalizations_date_idx
  ON class_attendance_finalizations(school_id,school_date,finalized);
CREATE TABLE IF NOT EXISTS class_attendance_finalization_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  period_id UUID NOT NULL,
  school_date DATE NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('FINALIZE','REOPEN')),
  actor_user_id UUID NOT NULL,
  roster_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id,period_id,school_date)
    REFERENCES class_attendance_finalizations(school_id,period_id,school_date) ON DELETE CASCADE,
  FOREIGN KEY (school_id,actor_user_id) REFERENCES school_users(school_id,user_id)
);
