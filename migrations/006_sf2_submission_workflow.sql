-- SF2 learner sex classification, confirmed absence overrides, and submitted-report tracking.
-- Apply after 005_roles_and_class_advisers.sql and only after the authentication foundation is complete.

DO $$
BEGIN
  IF to_regclass('public.school_users') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.schools') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'SF2 workflow migration stopped: required core school, student, or audit tables are missing.';
  END IF;
END $$;

ALTER TABLE students ADD COLUMN IF NOT EXISTS sex VARCHAR(10);
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_sex_check;
ALTER TABLE students ADD CONSTRAINT students_sex_check
  CHECK (sex IS NULL OR sex IN ('MALE','FEMALE'));

CREATE TABLE IF NOT EXISTS sf2_daily_overrides (
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  school_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ABSENT' CHECK (status='ABSENT'),
  absence_type VARCHAR(20) NOT NULL DEFAULT 'UNEXCUSED' CHECK (absence_type IN ('EXCUSED','UNEXCUSED')),
  note TEXT,
  recorded_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id,student_id,school_date),
  CONSTRAINT sf2_daily_overrides_student_fk
    FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,student_id) ON DELETE CASCADE,
  CONSTRAINT sf2_daily_overrides_recorder_fk
    FOREIGN KEY (school_id,recorded_by_user_id) REFERENCES school_users(school_id,user_id)
);
CREATE INDEX IF NOT EXISTS sf2_daily_overrides_month_idx
  ON sf2_daily_overrides(school_id,school_date);

CREATE TABLE IF NOT EXISTS sf2_submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  reporting_month DATE NOT NULL CHECK (EXTRACT(DAY FROM reporting_month)=1),
  grade_level TEXT NOT NULL,
  section TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','COLLECTED')),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  submitted_by_user_id UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  collected_by_user_id UUID,
  collected_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sf2_submissions_submitter_fk
    FOREIGN KEY (school_id,submitted_by_user_id) REFERENCES school_users(school_id,user_id),
  CONSTRAINT sf2_submissions_collector_fk
    FOREIGN KEY (school_id,collected_by_user_id) REFERENCES school_users(school_id,user_id),
  UNIQUE (school_id,reporting_month,grade_level,section,revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS sf2_submissions_current_section_month_idx
  ON sf2_submissions(school_id,reporting_month,grade_level,section) WHERE is_current=TRUE;
CREATE INDEX IF NOT EXISTS sf2_submissions_school_month_idx
  ON sf2_submissions(school_id,reporting_month DESC,status);

COMMENT ON TABLE sf2_daily_overrides IS
  'Explicit Class Adviser/Admin confirmed daily absences; missing scans alone are never marked absent.';
COMMENT ON TABLE sf2_submissions IS
  'Versioned monthly official SF2 reports submitted by assigned Class Advisers and collected by the School Administrator.';
