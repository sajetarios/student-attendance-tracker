-- Track schedule activity independently from the school timetable's period label.
-- Existing class schedules retain their current labels and are treated as regular classes.
ALTER TABLE class_periods
  ADD COLUMN IF NOT EXISTS schedule_type TEXT NOT NULL DEFAULT 'CLASS';
ALTER TABLE class_periods
  DROP CONSTRAINT IF EXISTS class_periods_schedule_type_check;
ALTER TABLE class_periods
  ADD CONSTRAINT class_periods_schedule_type_check
  CHECK (schedule_type IN ('CLASS','ADVISORY','OTHER'));
