-- Correct the intentionally mis-entered DEMO001 subject/department relationships.
-- This migration is intentionally limited to one demo school. It snapshots every
-- affected row before changes and leaves student, QR, and attendance data untouched.

INSERT INTO school_departments (school_id, department_code, department_name, description)
SELECT school_id, 'SCI-2026', 'Science Department',
       'Department created to correct the DEMO001 subject catalogue.'
FROM schools
WHERE school_code='DEMO001' AND active=TRUE
ON CONFLICT DO NOTHING;

UPDATE school_departments d
SET department_name='Science Department',
    active=TRUE,
    updated_at=NOW()
FROM schools s
WHERE d.school_id=s.school_id
  AND s.school_code='DEMO001'
  AND d.department_code='SCI-2026';

CREATE TABLE IF NOT EXISTS demo001_department_correction_backup (
  backup_key TEXT PRIMARY KEY,
  school_code TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  before_state JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  v_school_id UUID;
  v_english_id UUID;
  v_math_id UUID;
  v_science_id UUID;
  v_dorothy_id UUID;
  v_science_teacher_id UUID;
  v_english_period_id UUID;
  v_math_subject_count INTEGER;
  v_science_subject_count INTEGER;
  v_english_assignment_count INTEGER;
  v_science_assignment_count INTEGER;
BEGIN
  SELECT school_id INTO v_school_id
  FROM schools
  WHERE school_code='DEMO001' AND active=TRUE;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: active demo school was not found.';
  END IF;

  SELECT department_id INTO v_english_id
  FROM school_departments
  WHERE school_id=v_school_id AND department_code='ENG-2026' AND active=TRUE;

  SELECT department_id INTO v_math_id
  FROM school_departments
  WHERE school_id=v_school_id AND department_code='MATH2026' AND active=TRUE;

  SELECT department_id INTO v_science_id
  FROM school_departments
  WHERE school_id=v_school_id AND department_code='SCI-2026' AND active=TRUE;

  IF v_english_id IS NULL OR v_math_id IS NULL OR v_science_id IS NULL THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: English, Math, and Science departments must all exist and be active.';
  END IF;

  IF v_english_id=v_math_id OR v_english_id=v_science_id OR v_math_id=v_science_id THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: department IDs are not distinct.';
  END IF;

  SELECT COUNT(*) INTO v_math_subject_count
  FROM school_subjects
  WHERE school_id=v_school_id AND department_id=v_english_id
    AND lower(btrim(subject_name))='mathematics';

  SELECT COUNT(*) INTO v_science_subject_count
  FROM school_subjects
  WHERE school_id=v_school_id AND department_id=v_english_id
    AND lower(btrim(subject_name))='science';

  IF v_math_subject_count<>1 OR v_science_subject_count<>1 THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: expected exactly one Mathematics and one Science catalogue entry under English Department.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM school_subjects
    WHERE school_id=v_school_id AND department_id=v_math_id
      AND lower(btrim(subject_name))='mathematics'
  ) OR EXISTS (
    SELECT 1 FROM school_subjects
    WHERE school_id=v_school_id AND department_id=v_science_id
      AND lower(btrim(subject_name))='science'
  ) THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: target departments already contain Mathematics or Science catalogue entries. Manual reconciliation is required.';
  END IF;

  SELECT user_id INTO v_dorothy_id
  FROM school_users
  WHERE school_id=v_school_id AND role='TEACHER' AND username='Dowthii';

  SELECT user_id INTO v_science_teacher_id
  FROM school_users
  WHERE school_id=v_school_id AND role='TEACHER' AND username='Class_Adviser001';

  IF v_dorothy_id IS NULL OR v_science_teacher_id IS NULL THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: expected demo teacher accounts were not found.';
  END IF;

  IF (SELECT COUNT(*) FROM teacher_period_assignments a
      JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
      WHERE a.school_id=v_school_id AND a.teacher_user_id=v_dorothy_id
        AND lower(btrim(p.subject_name))='mathematics')<>1
     OR EXISTS (
      SELECT 1 FROM teacher_period_assignments a
      JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
      WHERE a.school_id=v_school_id AND a.teacher_user_id=v_dorothy_id
        AND lower(btrim(p.subject_name))<>'mathematics'
     ) THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: Dorothy has unexpected schedule assignments; no staff records were changed.';
  END IF;

  SELECT COUNT(*) INTO v_english_assignment_count
  FROM teacher_period_assignments a
  JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
  WHERE a.school_id=v_school_id AND a.teacher_user_id=v_science_teacher_id
    AND lower(btrim(p.subject_name))='english'
    AND lower(btrim(p.grade_level))='grade 7'
    AND upper(btrim(p.section))='ROXAS';

  SELECT COUNT(*) INTO v_science_assignment_count
  FROM teacher_period_assignments a
  JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
  WHERE a.school_id=v_school_id AND a.teacher_user_id=v_science_teacher_id
    AND lower(btrim(p.subject_name))='science'
    AND lower(btrim(p.grade_level))='grade 8'
    AND upper(btrim(p.section))='MENDEL';

  IF v_english_assignment_count<>1 OR v_science_assignment_count<>1 THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: expected the Science demo teacher to have exactly the known English and Science demo assignments.';
  END IF;

  SELECT p.period_id INTO v_english_period_id
  FROM class_periods p
  WHERE p.school_id=v_school_id
    AND lower(btrim(p.subject_name))='english'
    AND lower(btrim(p.grade_level))='grade 7'
    AND upper(btrim(p.section))='ROXAS'
    AND p.active=TRUE;

  IF v_english_period_id IS NULL THEN
    RAISE EXCEPTION 'DEMO001 correction stopped: the existing English Grade 7 Roxas schedule was not found.';
  END IF;
END $$;

-- Capture exact pre-change rows. The backup is retained in the database for recovery/audit.
INSERT INTO demo001_department_correction_backup
  (backup_key, school_code, record_type, record_id, before_state)
SELECT 'department:' || d.department_id::text, 'DEMO001', 'school_departments',
       d.department_id::text, to_jsonb(d)
FROM school_departments d
JOIN schools s ON s.school_id=d.school_id
WHERE s.school_code='DEMO001' AND d.department_code IN ('ENG-2026','MATH2026','SCI-2026')
ON CONFLICT (backup_key) DO NOTHING;

INSERT INTO demo001_department_correction_backup
  (backup_key, school_code, record_type, record_id, before_state)
SELECT 'subject:' || sub.subject_id::text, 'DEMO001', 'school_subjects',
       sub.subject_id::text, to_jsonb(sub)
FROM school_subjects sub
JOIN schools s ON s.school_id=sub.school_id
JOIN school_departments d ON d.school_id=sub.school_id AND d.department_id=sub.department_id
WHERE s.school_code='DEMO001'
  AND d.department_code='ENG-2026'
  AND lower(btrim(sub.subject_name)) IN ('english','mathematics','science')
ON CONFLICT (backup_key) DO NOTHING;

INSERT INTO demo001_department_correction_backup
  (backup_key, school_code, record_type, record_id, before_state)
SELECT 'schedule:' || p.period_id::text, 'DEMO001', 'class_periods',
       p.period_id::text, to_jsonb(p)
FROM class_periods p
JOIN schools s ON s.school_id=p.school_id
WHERE s.school_code='DEMO001'
  AND lower(btrim(p.subject_name)) IN ('english','mathematics','science')
ON CONFLICT (backup_key) DO NOTHING;

INSERT INTO demo001_department_correction_backup
  (backup_key, school_code, record_type, record_id, before_state)
SELECT 'teacher:' || su.user_id::text, 'DEMO001', 'school_users',
       su.user_id::text, to_jsonb(su)
FROM school_users su
JOIN schools s ON s.school_id=su.school_id
WHERE s.school_code='DEMO001'
  AND su.role='TEACHER'
  AND su.username IN ('Dowthii','Class_Adviser001')
ON CONFLICT (backup_key) DO NOTHING;

INSERT INTO demo001_department_correction_backup
  (backup_key, school_code, record_type, record_id, before_state)
SELECT 'assignment:' || a.assignment_id::text, 'DEMO001', 'teacher_period_assignments',
       a.assignment_id::text, to_jsonb(a)
FROM teacher_period_assignments a
JOIN schools s ON s.school_id=a.school_id
JOIN school_users su ON su.school_id=a.school_id AND su.user_id=a.teacher_user_id
WHERE s.school_code='DEMO001'
  AND su.username IN ('Dowthii','Class_Adviser001')
ON CONFLICT (backup_key) DO NOTHING;

-- Move the canonical catalogue records, retaining their subject IDs.
UPDATE school_subjects sub
SET department_id=target.department_id, updated_at=NOW()
FROM schools s,
     school_departments source,
     school_departments target
WHERE sub.school_id=s.school_id
  AND source.school_id=sub.school_id AND source.department_id=sub.department_id
  AND target.school_id=sub.school_id
  AND s.school_code='DEMO001'
  AND source.department_code='ENG-2026'
  AND lower(btrim(sub.subject_name))='mathematics'
  AND target.department_code='MATH2026';

UPDATE school_subjects sub
SET department_id=target.department_id, updated_at=NOW()
FROM schools s,
     school_departments source,
     school_departments target
WHERE sub.school_id=s.school_id
  AND source.school_id=sub.school_id AND source.department_id=sub.department_id
  AND target.school_id=sub.school_id
  AND s.school_code='DEMO001'
  AND source.department_code='ENG-2026'
  AND lower(btrim(sub.subject_name))='science'
  AND target.department_code='SCI-2026';

-- Keep every schedule linked to the same canonical subject ID and move its department.
UPDATE class_periods p
SET department_id=sub.department_id
FROM school_subjects sub
JOIN schools s ON s.school_id=sub.school_id
WHERE p.school_id=sub.school_id
  AND p.subject_id=sub.subject_id
  AND s.school_code='DEMO001'
  AND lower(btrim(sub.subject_name)) IN ('mathematics','science');

-- The English schedule remains active. There is no English-department teacher account
-- in this demo school, so remove only its incorrectly assigned Science demo teacher.
DELETE FROM teacher_period_assignments a
USING class_periods p, schools s, school_users su
WHERE a.school_id=p.school_id AND a.period_id=p.period_id
  AND s.school_id=a.school_id AND su.school_id=a.school_id AND su.user_id=a.teacher_user_id
  AND s.school_code='DEMO001'
  AND su.username='Class_Adviser001'
  AND lower(btrim(p.subject_name))='english'
  AND lower(btrim(p.grade_level))='grade 7'
  AND upper(btrim(p.section))='ROXAS';

-- Place each demo teacher in the department matching their retained subject schedule.
UPDATE school_users su
SET department_id=d.department_id, updated_at=NOW()
FROM schools s, school_departments d
WHERE su.school_id=s.school_id
  AND d.school_id=su.school_id
  AND s.school_code='DEMO001'
  AND su.role='TEACHER'
  AND su.username='Dowthii'
  AND d.department_code='MATH2026';

UPDATE school_users su
SET department_id=d.department_id, updated_at=NOW()
FROM schools s, school_departments d
WHERE su.school_id=s.school_id
  AND d.school_id=su.school_id
  AND s.school_code='DEMO001'
  AND su.role='TEACHER'
  AND su.username='Class_Adviser001'
  AND d.department_code='SCI-2026';

-- Record the correction in the existing audit trail. The source snapshots above are
-- retained separately so that the exact pre-change assignments can be reconstructed.
INSERT INTO audit_logs
  (school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
SELECT s.school_id, 'SYSTEM', NULL, 'SYSTEM_DEMO001_CORRECT_SUBJECT_DEPARTMENTS',
       'school_department', 'DEMO001',
       jsonb_build_object(
         'subjectDepartmentMapping', jsonb_build_object(
           'English','ENG-2026',
           'Mathematics','MATH2026',
           'Science','SCI-2026'
         ),
         'teacherDepartmentMapping', jsonb_build_object(
           'Dowthii','MATH2026',
           'Class_Adviser001','SCI-2026'
         ),
         'englishScheduleAssignment','Removed mismatched Science demo teacher; English schedule retained as unassigned.',
         'backupTable','demo001_department_correction_backup'
       )
FROM schools s
WHERE s.school_code='DEMO001'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.school_id=s.school_id
      AND a.action='SYSTEM_DEMO001_CORRECT_SUBJECT_DEPARTMENTS'
      AND a.entity_id='DEMO001'
  );
