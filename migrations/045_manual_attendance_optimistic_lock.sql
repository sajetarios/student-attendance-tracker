-- Optimistic concurrency for paper/manual attendance marks.
-- Existing marks are assigned revision 1 without changing their status, note, or audit history.
-- A monotonically increasing integer avoids timestamp precision/race ambiguity.
ALTER TABLE manual_attendance_marks
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE manual_attendance_marks
  DROP CONSTRAINT IF EXISTS manual_attendance_marks_revision_positive;
ALTER TABLE manual_attendance_marks
  ADD CONSTRAINT manual_attendance_marks_revision_positive CHECK (revision >= 1);
