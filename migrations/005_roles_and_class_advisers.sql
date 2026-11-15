-- Role and teacher designation foundation for the Student Attendance Tracker.
-- Apply only after migrations 002 and 004 have completed successfully.
-- This migration preserves existing TEACHER accounts and teacher_period_assignments.

DO $$
BEGIN
  IF to_regclass('public.school_users') IS NULL
     OR to_regclass('public.teacher_period_assignments') IS NULL
     OR to_regclass('public.class_periods') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'Role migration stopped: required school user, schedule, assignment, or audit tables are missing.';
  END IF;
END $$;

ALTER TABLE school_users
  ADD COLUMN IF NOT EXISTS teacher_designations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing teacher accounts remain subject teachers, so their schedule access is preserved.
UPDATE school_users
SET teacher_designations = ARRAY['SUBJECT_TEACHER']::TEXT[]
WHERE role = 'TEACHER'
  AND COALESCE(cardinality(teacher_designations), 0) = 0;

ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_role_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_role_check
  CHECK (role = ANY (ARRAY[
    'SCHOOL_ADMIN'::TEXT,
    'DEPARTMENT_HEAD'::TEXT,
    'TEACHER'::TEXT,
    'GATE_KEEPER'::TEXT,
    'PARENT'::TEXT
  ]));

ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_teacher_designations_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_teacher_designations_check
  CHECK (
    (role = 'TEACHER'
      AND cardinality(teacher_designations) >= 1
      AND teacher_designations <@ ARRAY['CLASS_ADVISER'::TEXT, 'SUBJECT_TEACHER'::TEXT])
    OR
    (role <> 'TEACHER' AND cardinality(teacher_designations) = 0)
  );

CREATE TABLE IF NOT EXISTS class_adviser_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  adviser_user_id UUID NOT NULL,
  grade_level TEXT NOT NULL CHECK (length(trim(grade_level)) BETWEEN 1 AND 40),
  section TEXT NOT NULL CHECK (length(trim(section)) BETWEEN 1 AND 100),
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_adviser_assignments_one_adviser_per_section
    UNIQUE (school_id, grade_level, section),
  CONSTRAINT class_adviser_assignments_adviser_fk
    FOREIGN KEY (school_id, adviser_user_id)
    REFERENCES school_users(school_id, user_id) ON DELETE CASCADE,
  CONSTRAINT class_adviser_assignments_assigner_fk
    FOREIGN KEY (school_id, assigned_by)
    REFERENCES school_users(school_id, user_id)
);

CREATE INDEX IF NOT EXISTS class_adviser_assignments_by_teacher_idx
  ON class_adviser_assignments (school_id, adviser_user_id);

CREATE OR REPLACE FUNCTION validate_class_adviser_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM school_users su
    WHERE su.school_id = NEW.school_id
      AND su.user_id = NEW.adviser_user_id
      AND su.role = 'TEACHER'
      AND su.active = TRUE
      AND 'CLASS_ADVISER' = ANY(su.teacher_designations)
  ) THEN
    RAISE EXCEPTION 'Assigned account must be an active teacher designated as a Class Adviser.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS class_adviser_assignment_validate ON class_adviser_assignments;
CREATE TRIGGER class_adviser_assignment_validate
BEFORE INSERT OR UPDATE OF school_id, adviser_user_id
ON class_adviser_assignments
FOR EACH ROW EXECUTE FUNCTION validate_class_adviser_assignment();

-- Prevent removing the Subject Teacher designation while permanent schedules remain assigned.
CREATE OR REPLACE FUNCTION protect_teacher_subject_designation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role = 'TEACHER'
     AND 'SUBJECT_TEACHER' = ANY(OLD.teacher_designations)
     AND NOT ('SUBJECT_TEACHER' = ANY(NEW.teacher_designations))
     AND EXISTS (
       SELECT 1 FROM teacher_period_assignments a
       WHERE a.school_id = OLD.school_id AND a.teacher_user_id = OLD.user_id
     ) THEN
    RAISE EXCEPTION 'Remove or reassign the teacher''s class schedules before removing the Subject Teacher designation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_users_protect_subject_designation ON school_users;
CREATE TRIGGER school_users_protect_subject_designation
BEFORE UPDATE OF teacher_designations ON school_users
FOR EACH ROW EXECUTE FUNCTION protect_teacher_subject_designation();


-- Prevent removing the Class Adviser designation while section assignments remain.
CREATE OR REPLACE FUNCTION protect_teacher_adviser_designation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role = 'TEACHER'
     AND 'CLASS_ADVISER' = ANY(OLD.teacher_designations)
     AND NOT ('CLASS_ADVISER' = ANY(NEW.teacher_designations))
     AND EXISTS (
       SELECT 1 FROM class_adviser_assignments ca
       WHERE ca.school_id = OLD.school_id AND ca.adviser_user_id = OLD.user_id
     ) THEN
    RAISE EXCEPTION 'Remove the teacher''s Class Adviser section assignments before removing the Class Adviser designation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_users_protect_adviser_designation ON school_users;
CREATE TRIGGER school_users_protect_adviser_designation
BEFORE UPDATE OF teacher_designations ON school_users
FOR EACH ROW EXECUTE FUNCTION protect_teacher_adviser_designation();

-- Audit migration state and the designation model without changing attendance data.
COMMENT ON COLUMN school_users.teacher_designations IS
  'Teacher-only capabilities: CLASS_ADVISER, SUBJECT_TEACHER, or both. Teacher role remains TEACHER.';
COMMENT ON TABLE class_adviser_assignments IS
  'Assigns one active Class Adviser teacher to each grade/section. Does not alter subject-period assignments.';

-- Verify:
-- SELECT role, teacher_designations, COUNT(*) FROM school_users GROUP BY role, teacher_designations ORDER BY role;
-- SELECT * FROM class_adviser_assignments ORDER BY grade_level, section;
