-- DEMO001-only correction. All records are synthetic/test data.
-- Preserve existing school logins, hashes, and existing REAL schools.
DO $demo$
DECLARE sid uuid; fil_head uuid;
BEGIN
  SELECT school_id INTO sid FROM schools WHERE school_code='DEMO001' AND active=TRUE LIMIT 1;
  IF sid IS NULL THEN RETURN; END IF;

  -- A named Filipino Department Head was accidentally created as a teacher.
  -- Never convert an account that now owns teaching/advisory assignments.
  SELECT user_id INTO fil_head
  FROM school_users
  WHERE school_id=sid AND username='FIL-DEP001' AND role='TEACHER' AND active=TRUE
    AND NOT EXISTS (SELECT 1 FROM teacher_period_assignments a WHERE a.school_id=sid AND a.teacher_user_id=school_users.user_id)
    AND NOT EXISTS (SELECT 1 FROM class_adviser_assignments a WHERE a.school_id=sid AND a.adviser_user_id=school_users.user_id)
    AND NOT EXISTS (SELECT 1 FROM teacher_period_substitutions a WHERE a.school_id=sid AND (a.original_teacher_user_id=school_users.user_id OR a.substitute_teacher_user_id=school_users.user_id))
  LIMIT 1;
  IF fil_head IS NOT NULL THEN
    UPDATE school_users
       SET role='DEPARTMENT_HEAD',teacher_designations=ARRAY[]::text[],
           teacher_qr_token=NULL,teacher_status='ACTIVE',
           session_version=session_version+1,updated_at=NOW()
     WHERE school_id=sid AND user_id=fil_head;
    UPDATE user_sessions SET revoked_at=NOW()
     WHERE school_id=sid AND school_user_id=fil_head AND revoked_at IS NULL;
    INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
      VALUES(sid,'SYSTEM',NULL,'DEMO_FIX_FILIPINO_DEPARTMENT_HEAD_ROLE','school_user',fil_head::text,
             '{"demo":true,"previousRole":"TEACHER","newRole":"DEPARTMENT_HEAD"}'::jsonb);
  END IF;

  -- Clear *only* the Grade 8 demo section's November 2026 manual absence overrides.
  -- Rebuild consistent, fictional demo absences spread across multiple learners.
  DELETE FROM sf2_daily_overrides o
    USING students st
   WHERE o.school_id=sid AND st.school_id=sid AND o.student_id=st.student_id
     AND st.student_id LIKE 'DEMO-G8-%'
     AND st.grade_level='Grade 8' AND st.section='Rizal - DEMO'
     AND o.school_date >= DATE '2026-11-01' AND o.school_date < DATE '2026-12-01';

  INSERT INTO sf2_daily_overrides
    (school_id,student_id,school_date,status,absence_type,note,recorded_by_user_id)
  SELECT st.school_id,st.student_id,day_slot.d::date,'ABSENT',
    CASE WHEN (right(st.student_id,3)::int + EXTRACT(day FROM day_slot.d)::int)%2=0 THEN 'EXCUSED' ELSE 'UNEXCUSED' END,
    'SYNTHETIC DEMO - not verified student attendance', ca.adviser_user_id
  FROM students st
  JOIN school_years sy ON sy.school_id=st.school_id AND sy.status='ACTIVE'
  JOIN student_enrollments en ON en.school_id=st.school_id AND en.student_id=st.student_id
    AND en.school_year_id=sy.school_year_id AND en.enrollment_status='ENROLLED'
  LEFT JOIN class_adviser_assignments ca ON ca.school_id=st.school_id
    AND ca.grade_level='Grade 8' AND ca.section='Rizal - DEMO'
  CROSS JOIN generate_series(DATE '2026-11-02',DATE '2026-11-30',INTERVAL '1 day') AS day_slot(d)
  WHERE st.school_id=sid AND st.active=TRUE
    AND st.student_id ~ '^DEMO-G8-[0-9]{3}$'
    AND st.grade_level='Grade 8' AND st.section='Rizal - DEMO'
    AND EXTRACT(ISODOW FROM day_slot.d) BETWEEN 1 AND 5
    AND ((right(st.student_id,3)::int * 7 + EXTRACT(day FROM day_slot.d)::int) % 19 = 0)
    AND NOT EXISTS (SELECT 1 FROM attendance_events e
      WHERE e.school_id=sid AND e.student_id=st.student_id AND e.school_date=day_slot.d::date
        AND e.attendance_scope IN ('CLASS','ADVISORY') AND e.event_type='TIME_IN'
        AND e.sync_status='ACCEPTED');

  -- Class/advisory records (not gate scans) are what the official SF2 counts.
  -- All dates, including dates later than migration day, are deliberately synthetic.
  INSERT INTO attendance_events
    (event_id,school_id,device_id,student_id,attendance_scope,period_id,
     event_type,occurred_at_device,school_date,late,sync_status,metadata,recorded_by_user_id)
  SELECT gen_random_uuid(),st.school_id,'DEMO-SF2-CLASS',st.student_id,'CLASS',cp.period_id,
         'TIME_IN',(day_slot.d::date + TIME '08:05') AT TIME ZONE 'Asia/Manila',
         day_slot.d::date,FALSE,'ACCEPTED',
         jsonb_build_object('demo',true,'source','synthetic-sf2-preview','notOfficial',true),
         ca.adviser_user_id
  FROM students st
  JOIN school_years sy ON sy.school_id=st.school_id AND sy.status='ACTIVE'
  JOIN student_enrollments en ON en.school_id=st.school_id AND en.student_id=st.student_id
    AND en.school_year_id=sy.school_year_id AND en.enrollment_status='ENROLLED'
  JOIN class_periods cp ON cp.school_id=st.school_id AND cp.active=TRUE
    AND cp.grade_level='Grade 8' AND cp.section='Rizal - DEMO' AND cp.period_name='DEMO English 8'
  JOIN class_adviser_assignments ca ON ca.school_id=st.school_id
    AND ca.grade_level='Grade 8' AND ca.section='Rizal - DEMO'
  CROSS JOIN generate_series(DATE '2026-11-02',DATE '2026-11-30',INTERVAL '1 day') AS day_slot(d)
  WHERE st.school_id=sid AND st.active=TRUE
    AND st.student_id ~ '^DEMO-G8-[0-9]{3}$'
    AND st.grade_level='Grade 8' AND st.section='Rizal - DEMO'
    AND EXTRACT(ISODOW FROM day_slot.d) BETWEEN 1 AND 5
    AND NOT EXISTS (SELECT 1 FROM sf2_daily_overrides o
      WHERE o.school_id=sid AND o.student_id=st.student_id AND o.school_date=day_slot.d::date AND o.status='ABSENT')
    AND NOT EXISTS (SELECT 1 FROM attendance_events e
      WHERE e.school_id=sid AND e.student_id=st.student_id AND e.school_date=day_slot.d::date
        AND e.attendance_scope IN ('CLASS','ADVISORY') AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED');
END
$demo$;
