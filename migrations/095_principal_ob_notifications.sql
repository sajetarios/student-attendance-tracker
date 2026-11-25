-- Route internal OB notifications to the Principal; retain existing event keys.
CREATE OR REPLACE FUNCTION attendigo_ob_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 r RECORD; staff_role TEXT; staff_name TEXT;
 k TEXT := 'official-business:'||NEW.request_id::text;
 personal_url TEXT := '/portal.html#officialBusiness';
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT role,display_name INTO staff_role,staff_name FROM school_users
 WHERE school_id=NEW.school_id AND user_id=NEW.staff_user_id;
 -- The principal's external SDO handoff is a different workflow.
 IF staff_role='PRINCIPAL' THEN RETURN NEW; END IF;
 IF staff_role='SCHOOL_ADMIN' THEN personal_url:='/portal.html?view=myGateAttendance'; END IF;
 IF NEW.status='PENDING_HEAD' AND staff_role<>'DEPARTMENT_HEAD' THEN
  IF TG_OP='INSERT' THEN
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,k||':submitted','REQUEST',
    'Official Business submitted','Awaiting Department Head recommendation.','OFFICIAL_BUSINESS',NEW.request_id,NEW.status,personal_url);
  END IF;
  FOR r IN SELECT user_id FROM school_users WHERE school_id=NEW.school_id AND department_id=NEW.department_id
   AND role='DEPARTMENT_HEAD' AND active=TRUE AND user_id<>NEW.staff_user_id LOOP
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',r.user_id,k||':pending-head','APPROVAL',
    'Official Business awaiting recommendation','A department OB request needs review.','OFFICIAL_BUSINESS',NEW.request_id,NEW.status,'/portal.html#officialBusiness');
  END LOOP;
 ELSIF NEW.status='PENDING_ADMIN' OR (NEW.status='PENDING_HEAD' AND staff_role='DEPARTMENT_HEAD') THEN
  UPDATE user_notifications SET status='REVIEWED',read_at=COALESCE(read_at,NOW()),updated_at=NOW()
   WHERE school_id=NEW.school_id AND request_id=NEW.request_id AND event_key=k||':pending-head';
  PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,k||':recommended','REQUEST',
   'Official Business ready for signature','Print the Locator Slip and obtain the Principal''s handwritten signature, or the applicable travel authority.',
   'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_ADMIN',personal_url);
  FOR r IN SELECT user_id FROM school_users WHERE school_id=NEW.school_id AND role='PRINCIPAL' AND active=TRUE AND user_id<>NEW.staff_user_id LOOP
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',r.user_id,k||':pending-principal','APPROVAL',
    'Official Business awaiting authorization','A staff OB request is ready for your decision.',
    'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_ADMIN','/principal.html#priorities');
  END LOOP;
 ELSIF NEW.status IN ('APPROVED','REJECTED','CANCELLED') THEN
  UPDATE user_notifications SET status=NEW.status,read_at=COALESCE(read_at,NOW()),updated_at=NOW(),
   title='Official Business review completed',body='This request has been decided.'
   WHERE school_id=NEW.school_id AND request_id=NEW.request_id
   AND event_key IN (k||':pending-head',k||':pending-admin',k||':pending-principal');
  PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,k||':final-'||lower(NEW.status),'REQUEST',
   'Official Business '||lower(NEW.status),'Review your recorded OB decision.','OFFICIAL_BUSINESS',NEW.request_id,NEW.status,personal_url);
  IF NEW.admin_decided_at IS NOT NULL THEN
   FOR r IN SELECT user_id FROM school_users WHERE school_id=NEW.school_id AND department_id=NEW.department_id
    AND role='DEPARTMENT_HEAD' AND active=TRUE AND user_id<>NEW.staff_user_id LOOP
    PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',r.user_id,k||':department-final-'||lower(NEW.status),'REQUEST',
     'Department Official Business '||lower(NEW.status),'A department OB decision is available.','OFFICIAL_BUSINESS',NEW.request_id,NEW.status,'/portal.html#officialBusiness');
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
-- Retire obsolete Admin approval alerts without removing request/audit history.
UPDATE user_notifications n SET status='ROUTED',read_at=COALESCE(n.read_at,NOW()),updated_at=NOW(),
 title='Official Business routed to authorized approver',body='This request is no longer an administrative approval task.',action_url=''
WHERE n.request_type='OFFICIAL_BUSINESS' AND n.event_key LIKE 'official-business:%:pending-admin';
-- Backfill pending internal OB requests for Principals, including older Head submissions.
INSERT INTO user_notifications(school_id,recipient_kind,recipient_id,event_key,category,title,body,request_type,request_id,status,action_url)
SELECT o.school_id,'SCHOOL_USER',p.user_id,'official-business:'||o.request_id::text||':pending-principal','APPROVAL',
 'Official Business awaiting authorization','A staff OB request is ready for your decision.','OFFICIAL_BUSINESS',o.request_id,'PENDING_ADMIN','/principal.html#priorities'
FROM staff_official_business_requests o
JOIN school_users u ON u.school_id=o.school_id AND u.user_id=o.staff_user_id
JOIN school_users p ON p.school_id=o.school_id AND p.role='PRINCIPAL' AND p.active=TRUE AND p.user_id<>o.staff_user_id
WHERE u.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN') AND (o.status='PENDING_ADMIN' OR (o.status='PENDING_HEAD' AND u.role='DEPARTMENT_HEAD'))
ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING;
