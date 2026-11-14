-- Assign Dorothy Mae Sajetarios as Class Adviser for Grade 8 - SPJ.
-- This section is advisory-only and intentionally has no regular subject-period requirement.
-- The one-time assignment is limited to DEMO001 and is recorded against the authorizing
-- School Administrator in the existing audit trail.

DO $$
DECLARE
  v_school_id UUID;
  v_adviser_id UUID;
  v_adviser_department_id UUID;
  v_admin_id UUID;
  v_student_count INTEGER;
  v_existing_adviser_id UUID;
  v_assignment_id UUID;
BEGIN
  SELECT school_id INTO v_school_id
  FROM schools
  WHERE school_code='DEMO001' AND active=TRUE;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'SPJ adviser assignment stopped: active DEMO001 school was not found.';
  END IF;

  SELECT COUNT(*)
    INTO v_student_count
  FROM students s
  LEFT JOIN LATERAL (
    SELECT en.grade_level,en.section
    FROM student_enrollments en
    JOIN school_years sy
      ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
    WHERE en.school_id=s.school_id
      AND en.student_id=s.student_id
      AND sy.status='ACTIVE'
      AND en.enrollment_status='ENROLLED'
    ORDER BY en.created_at DESC
    LIMIT 1
  ) active_enrollment ON TRUE
  WHERE s.school_id=v_school_id
    AND s.active=TRUE
    AND s.archived_at IS NULL
    AND COALESCE(active_enrollment.grade_level,s.grade_level)='Grade 8'
    AND UPPER(BTRIM(COALESCE(active_enrollment.section,s.section)))='SPJ';

  IF v_student_count < 1 THEN
    RAISE EXCEPTION 'SPJ adviser assignment stopped: no active Grade 8 - SPJ learners are enrolled in the active school year.';
  END IF;

  SELECT COUNT(*)
    INTO v_student_count
  FROM school_users
  WHERE school_id=v_school_id
    AND username='Dowthii'
    AND display_name='Dorothy Mae Sajetarios'
    AND role='TEACHER'
    AND active=TRUE
    AND 'CLASS_ADVISER'=ANY(teacher_designations);

  IF v_student_count <> 1 THEN
    RAISE EXCEPTION 'SPJ adviser assignment stopped: expected exactly one active Dorothy Mae Sajetarios teacher account with Class Adviser designation.';
  END IF;

  SELECT user_id, department_id
    INTO v_adviser_id, v_adviser_department_id
  FROM school_users
  WHERE school_id=v_school_id
    AND username='Dowthii'
    AND display_name='Dorothy Mae Sajetarios'
    AND role='TEACHER'
    AND active=TRUE
    AND 'CLASS_ADVISER'=ANY(teacher_designations);

  IF v_adviser_id IS NULL OR v_adviser_department_id IS NULL THEN
    RAISE EXCEPTION 'SPJ adviser assignment stopped: Dorothy must have an active department assignment.';
  END IF;

  SELECT COUNT(*)
    INTO v_student_count
  FROM school_users
  WHERE school_id=v_school_id
    AND display_name='Demo001 School Administrator'
    AND role='SCHOOL_ADMIN'
    AND active=TRUE;

  IF v_student_count <> 1 THEN
    RAISE EXCEPTION 'SPJ adviser assignment stopped: expected exactly one active DEMO001 School Administrator for assignment audit attribution.';
  END IF;

  SELECT user_id INTO v_admin_id
  FROM school_users
  WHERE school_id=v_school_id
    AND display_name='Demo001 School Administrator'
    AND role='SCHOOL_ADMIN'
    AND active=TRUE;

  SELECT adviser_user_id INTO v_existing_adviser_id
  FROM class_adviser_assignments
  WHERE school_id=v_school_id
    AND lower(btrim(grade_level))=lower(btrim('Grade 8'))
    AND upper(btrim(section))='SPJ'
  LIMIT 1;

  IF v_existing_adviser_id IS NOT NULL THEN
    IF v_existing_adviser_id <> v_adviser_id THEN
      RAISE EXCEPTION 'SPJ adviser assignment stopped: Grade 8 - SPJ already has a different Class Adviser. Manual review is required.';
    END IF;
    -- The intended assignment already exists; leave it unchanged.
    RETURN;
  END IF;

  INSERT INTO class_adviser_assignments
    (school_id, adviser_user_id, grade_level, section, assigned_by)
  VALUES
    (v_school_id, v_adviser_id, 'Grade 8', 'SPJ', v_admin_id)
  RETURNING assignment_id INTO v_assignment_id;

  INSERT INTO audit_logs
    (school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
  VALUES
    (v_school_id, 'SCHOOL', v_admin_id, 'SCHOOL_ADMIN_ASSIGN_CLASS_ADVISER',
     'class_adviser_assignment', v_assignment_id::text,
     jsonb_build_object(
       'adviserUserId', v_adviser_id,
       'adviserName', 'Dorothy Mae Sajetarios',
       'gradeLevel', 'Grade 8',
       'section', 'SPJ',
       'advisoryOnly', TRUE,
       'source', 'school administrator confirmation'
     ));
END $$;
