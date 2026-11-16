-- Teacher position/rank is personnel information, never a permission or role.
-- Existing teacher accounts keep their roles, schedules and historical records.
ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS teacher_position TEXT;

ALTER TABLE school_users
  DROP CONSTRAINT IF EXISTS school_users_teacher_position_length;
ALTER TABLE school_users
  ADD CONSTRAINT school_users_teacher_position_length
  CHECK (teacher_position IS NULL OR char_length(teacher_position) <= 100);
