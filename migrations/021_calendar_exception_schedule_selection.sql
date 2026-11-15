-- Define exactly which class schedules operate on exception dates.
-- A shortened day requires an explicit school dismissal time.
ALTER TABLE school_calendar_exceptions
  ADD COLUMN IF NOT EXISTS dismissal_time TIME;

-- PostgreSQL requires a unique key for the composite school-scoped foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS school_calendar_exceptions_school_exception_uidx
  ON school_calendar_exceptions(school_id, exception_id);

CREATE TABLE IF NOT EXISTS school_calendar_exception_periods (
  school_id UUID NOT NULL,
  exception_id UUID NOT NULL,
  period_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, exception_id, period_id),
  FOREIGN KEY (school_id, exception_id)
    REFERENCES school_calendar_exceptions(school_id, exception_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, period_id)
    REFERENCES class_periods(school_id, period_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS school_calendar_exception_periods_period_idx
  ON school_calendar_exception_periods(school_id, period_id);
