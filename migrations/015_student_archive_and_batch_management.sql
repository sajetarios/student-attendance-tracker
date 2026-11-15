-- Add explicit archival state without changing historical enrollment or attendance records.
ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS students_school_active_roster_idx
  ON students(school_id, active, archived_at, full_name);
