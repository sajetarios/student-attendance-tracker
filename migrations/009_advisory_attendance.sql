-- Add a distinct attendance scope for Class Adviser / homeroom attendance.
-- Existing SCHOOL and CLASS records are preserved without rewriting historical events.

ALTER TABLE attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_attendance_scope_check;

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_attendance_scope_check
  CHECK (attendance_scope IN ('SCHOOL', 'CLASS', 'ADVISORY'));

ALTER TABLE attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_scope_period_check;

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_scope_period_check
  CHECK (
    (attendance_scope = 'CLASS' AND period_id IS NOT NULL)
    OR (attendance_scope IN ('SCHOOL', 'ADVISORY') AND period_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS attendance_events_advisory_section_date_idx
  ON attendance_events (school_id, school_date, student_id)
  WHERE attendance_scope = 'ADVISORY' AND sync_status = 'ACCEPTED';

COMMENT ON COLUMN attendance_events.attendance_scope IS
  'SCHOOL = gate attendance; CLASS = assigned subject period; ADVISORY = assigned Class Adviser attendance.';
