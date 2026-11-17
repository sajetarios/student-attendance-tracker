-- SARDO monitoring cases and append-only intervention history.
-- Attendance itself remains authoritative in SF2 and the subject attendance tables.
CREATE TABLE IF NOT EXISTS sardo_followups (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  streak_start DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CONTACTED','MONITORING','RESOLVED')),
  note TEXT NOT NULL DEFAULT '',
  updated_by_user_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, student_id, streak_start),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, student_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, updated_by_user_id) REFERENCES school_users(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS sardo_followups_school_updated_idx
  ON sardo_followups(school_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sardo_followup_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  streak_start DATE NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OPEN','CONTACTED','MONITORING','RESOLVED')),
  note TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, student_id, streak_start)
    REFERENCES sardo_followups(school_id, student_id, streak_start) ON DELETE CASCADE,
  FOREIGN KEY (school_id, actor_user_id)
    REFERENCES school_users(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS sardo_followup_events_history_idx
  ON sardo_followup_events(school_id, student_id, streak_start, created_at DESC);
