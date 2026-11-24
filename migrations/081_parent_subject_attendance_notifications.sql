-- 081: Notify verified guardians when a teacher finalizes an individual subject register.
-- Never derive subject attendance from physical gate events or provisional marks.
-- Re-finalization with an unchanged status is idempotent; a real correction updates the same inbox item.
CREATE OR REPLACE FUNCTION attendigo_parent_subject_finalized_notice()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action <> 'FINALIZE' THEN RETURN NEW; END IF;
 -- Explicit school opt-in prevents staging/database sharing from notifying real parents.
 IF NOT EXISTS (
   SELECT 1 FROM school_settings
   WHERE school_id=NEW.school_id AND setting_key='parent_subject_notifications'
     AND setting_value='true'::jsonb
 ) THEN RETURN NEW; END IF;

 INSERT INTO user_notifications
   (school_id,recipient_kind,recipient_id,event_key,category,title,body,status,action_url)
 SELECT NEW.school_id,'SCHOOL_USER',l.parent_user_id,
   'subject:'||NEW.school_id::text||':'||NEW.period_id::text||':'||NEW.school_date::text||':'||s.student_id,
   'SYSTEM',
   CASE WHEN att.result='ABSENT' THEN 'Subject absence confirmed'
        WHEN att.result='LATE' THEN 'Subject late attendance confirmed'
        WHEN att.result='EXCUSED' THEN 'Subject excuse recorded'
        ELSE 'Subject attendance confirmed' END,
   s.full_name||' was marked '||lower(att.result)||' in '||
     COALESCE(NULLIF(btrim(p.subject_name),''),p.period_name)||
     ' on '||to_char(NEW.school_date,'Mon DD, YYYY')||
     ' ('||to_char(p.start_time,'HH12:MI AM')||'–'||to_char(p.end_time,'HH12:MI AM')||
     '). Confirmed by the subject teacher.'||
     CASE WHEN att.result='ABSENT' AND EXISTS(
       SELECT 1 FROM attendance_events gate
       WHERE gate.school_id=NEW.school_id AND gate.student_id=s.student_id
         AND gate.school_date=NEW.school_date
         AND gate.attendance_scope='SCHOOL' AND gate.event_type='TIME_IN'
         AND gate.sync_status='ACCEPTED'
     ) THEN ' A separate school gate entry was recorded; this does not establish class attendance.'
     ELSE '' END,
   att.result,'/parent-portal.html'
 FROM class_periods p
 JOIN students s ON s.school_id=p.school_id AND s.active=TRUE
 LEFT JOIN LATERAL (
   SELECT en.grade_level,en.section FROM student_enrollments en
   JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
   WHERE en.school_id=s.school_id AND en.student_id=s.student_id
     AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
   ORDER BY en.created_at DESC LIMIT 1
 ) enrollment ON TRUE
 JOIN parent_student_links l ON l.school_id=s.school_id AND l.student_id=s.student_id
    AND l.status='APPROVED'
 JOIN school_users parent ON parent.school_id=l.school_id AND parent.user_id=l.parent_user_id
    AND parent.role='PARENT' AND parent.active=TRUE
 LEFT JOIN manual_attendance_marks m ON m.school_id=s.school_id
    AND m.student_id=s.student_id AND m.period_id=p.period_id AND m.school_date=NEW.school_date
 LEFT JOIN LATERAL (
   SELECT COUNT(*)>0 AS has_qr,COALESCE(bool_or(q.late),FALSE) AS has_late
   FROM attendance_events q
   WHERE q.school_id=s.school_id AND q.student_id=s.student_id AND q.period_id=p.period_id
     AND q.school_date=NEW.school_date AND q.attendance_scope='CLASS'
     AND q.event_type='TIME_IN' AND q.sync_status='ACCEPTED'
 ) qr ON TRUE
 CROSS JOIN LATERAL (
   SELECT CASE
     WHEN qr.has_qr AND m.status IN ('ABSENT','EXCUSED') THEN NULL
     WHEN m.status='LATE' OR qr.has_late THEN 'LATE'
     WHEN qr.has_qr OR m.status='PRESENT' THEN 'PRESENT'
     WHEN m.status IN ('ABSENT','EXCUSED') THEN m.status
     ELSE NULL END AS result
 ) att
 WHERE p.school_id=NEW.school_id AND p.period_id=NEW.period_id
   AND COALESCE(enrollment.grade_level,s.grade_level)=p.grade_level
   AND COALESCE(enrollment.section,s.section)=p.section
   AND att.result IS NOT NULL
 ON CONFLICT(recipient_kind,recipient_id,event_key) DO UPDATE
 SET title='Subject attendance corrected',body=EXCLUDED.body,status=EXCLUDED.status,
     read_at=NULL,updated_at=NOW()
 WHERE user_notifications.status IS DISTINCT FROM EXCLUDED.status;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS parent_subject_finalize_notification ON class_attendance_finalization_events;
CREATE TRIGGER parent_subject_finalize_notification
 AFTER INSERT ON class_attendance_finalization_events
 FOR EACH ROW EXECUTE FUNCTION attendigo_parent_subject_finalized_notice();

COMMENT ON FUNCTION attendigo_parent_subject_finalized_notice() IS
 'Guardian subject alerts require finalized teacher registers. Class-only evidence is authoritative; school gate evidence is contextual.';
