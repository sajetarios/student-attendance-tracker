-- Department ownership for staff and class periods.
DO $$
BEGIN
  IF to_regclass('public.schools') IS NULL OR to_regclass('public.school_users') IS NULL OR to_regclass('public.class_periods') IS NULL THEN
    RAISE EXCEPTION 'Department migration stopped: required school tables are missing.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_departments (
  department_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  department_code TEXT NOT NULL,
  department_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_departments_school_department_uk UNIQUE (school_id, department_id),
  CONSTRAINT school_departments_code_nonblank CHECK (length(trim(department_code)) BETWEEN 2 AND 20),
  CONSTRAINT school_departments_name_nonblank CHECK (length(trim(department_name)) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_departments_code_ci_uk ON school_departments(school_id, lower(department_code));

INSERT INTO school_departments(school_id, department_code, department_name, description)
SELECT school_id, 'UNASSIGNED', 'Unassigned', 'Default department for existing accounts and schedules pending school assignment.'
FROM schools ON CONFLICT DO NOTHING;

ALTER TABLE school_users ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE class_periods ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE class_periods ADD COLUMN IF NOT EXISTS classroom TEXT;

UPDATE school_users su SET department_id=d.department_id
FROM school_departments d
WHERE d.school_id=su.school_id AND d.department_code='UNASSIGNED' AND su.department_id IS NULL;
UPDATE class_periods p SET department_id=d.department_id
FROM school_departments d
WHERE d.school_id=p.school_id AND d.department_code='UNASSIGNED' AND p.department_id IS NULL;

ALTER TABLE school_users ALTER COLUMN department_id SET NOT NULL;
ALTER TABLE class_periods ALTER COLUMN department_id SET NOT NULL;

ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_department_fk;
ALTER TABLE school_users ADD CONSTRAINT school_users_department_fk
  FOREIGN KEY (school_id, department_id) REFERENCES school_departments(school_id, department_id) ON DELETE RESTRICT;
ALTER TABLE class_periods DROP CONSTRAINT IF EXISTS class_periods_department_fk;
ALTER TABLE class_periods ADD CONSTRAINT class_periods_department_fk
  FOREIGN KEY (school_id, department_id) REFERENCES school_departments(school_id, department_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS school_users_department_role_idx ON school_users(school_id, department_id, role, active);
CREATE INDEX IF NOT EXISTS class_periods_department_active_time_idx ON class_periods(school_id, department_id, active, start_time);

COMMENT ON TABLE school_departments IS 'Department Heads see every department but manage only their own department schedules and assignments.';
COMMENT ON COLUMN class_periods.classroom IS 'Physical room label shown in the timetable and class coverage monitor.';
