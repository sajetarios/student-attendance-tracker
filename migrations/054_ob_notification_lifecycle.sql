-- 054: Official Business lifecycle notifications, delivered through the existing
-- per-user bell inbox. Additive only: no attendance or OB history is rewritten.
-- Trigger runs in the same transaction as each authoritative OB status mutation.
CREATE OR REPLACE FUNCTION attendigo_ob_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 v_recipient RECORD;
 v_requester_name TEXT;
 v_key TEXT := 'official-business:' || NEW.request_id::text;
 v_url TEXT := '/portal.html#officialBusiness';
 v_title TEXT;
 v_body TEXT;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
   RETURN NEW;
 END IF;
 SELECT display_name INTO v_requester_name
 FROM school_users
 WHERE school_id=NEW.school_id AND user_id=NEW.staff_user_id;
 v_requester_name := COALESCE(NULLIF(v_requester_name,''),'A staff member');

 IF TG_OP='INSERT' THEN
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
     v_key||':submitted','REQUEST','Official Business request submitted',
     'Your OB request is awaiting Department Head recommendation.',
     'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_HEAD',v_url);
 END IF;

 IF NEW.status='PENDING_HEAD' THEN
   FOR v_recipient IN
     SELECT user_id FROM school_users
     WHERE school_id=NEW.school_id AND department_id=NEW.department_id
       AND role='DEPARTMENT_HEAD' AND active=TRUE
       AND user_id<>NEW.staff_user_id
   LOOP
     PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
       v_key||':pending-head','APPROVAL','Official Business awaiting recommendation',
       v_requester_name||' submitted an OB request for your department.',
       'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_HEAD',v_url);
   END LOOP;
 ELSIF NEW.status='PENDING_ADMIN' THEN
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
     v_key||':recommended','REQUEST','Official Business recommended',
     'Your OB request was recommended by the Department Head and awaits School Admin approval.',
     'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_ADMIN',v_url);
   FOR v_recipient IN
     SELECT user_id FROM school_users
     WHERE school_id=NEW.school_id AND role='SCHOOL_ADMIN' AND active=TRUE
       AND user_id<>NEW.staff_user_id
   LOOP
     PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
       v_key||':pending-admin','APPROVAL','Official Business awaiting final approval',
       v_requester_name||'''s OB request needs your final decision.',
       'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_ADMIN',v_url);
   END LOOP;
 ELSIF NEW.status IN ('APPROVED','REJECTED','CANCELLED') THEN
   v_title:=CASE NEW.status
     WHEN 'APPROVED' THEN 'Official Business approved'
     WHEN 'REJECTED' THEN 'Official Business rejected'
     ELSE 'Official Business cancelled' END;
   v_body:=CASE NEW.status
     WHEN 'APPROVED' THEN 'Your OB request received final School Admin approval.'
     WHEN 'REJECTED' THEN 'Your OB request was rejected.'
     ELSE 'Your OB request was cancelled.' END;
   IF NEW.decision_note IS NOT NULL AND btrim(NEW.decision_note)<>'' THEN
     v_body:=v_body||' Note: '||left(btrim(NEW.decision_note),300);
   END IF;
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
     v_key||':final-'||lower(NEW.status),'REQUEST',v_title,v_body,
     'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
   -- Keep the responsible department informed after the final admin decision.
   IF NEW.admin_decided_at IS NOT NULL THEN
     FOR v_recipient IN
       SELECT user_id FROM school_users
       WHERE school_id=NEW.school_id AND department_id=NEW.department_id
         AND role='DEPARTMENT_HEAD' AND active=TRUE
         AND user_id<>NEW.staff_user_id
     LOOP
       PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
         v_key||':department-final-'||lower(NEW.status),'REQUEST',v_title,
         v_requester_name||'''s OB request: '||lower(NEW.status)||'.',
         'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
     END LOOP;
   END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ob_request_notification ON staff_official_business_requests;
CREATE TRIGGER ob_request_notification
AFTER INSERT OR UPDATE OF status ON staff_official_business_requests
FOR EACH ROW EXECUTE FUNCTION attendigo_ob_notification_trigger();

-- Backfill ONLY unresolved requests. The existing event-key uniqueness makes this
-- safe to retry and avoids inflating unread counts for previously recorded events.
INSERT INTO user_notifications
 (school_id,recipient_kind,recipient_id,event_key,category,title,body,
  request_type,request_id,status,action_url,created_at)
SELECT ob.school_id,'SCHOOL_USER',head.user_id,
 'official-business:'||ob.request_id::text||':pending-head',
 'APPROVAL','Official Business awaiting recommendation',
 COALESCE(staff.display_name,'A staff member')||' submitted an OB request for your department.',
 'OFFICIAL_BUSINESS',ob.request_id,'PENDING_HEAD','/portal.html#officialBusiness',
 ob.submitted_at
FROM staff_official_business_requests ob
JOIN school_users head ON head.school_id=ob.school_id AND head.department_id=ob.department_id
 AND head.role='DEPARTMENT_HEAD' AND head.active=TRUE AND head.user_id<>ob.staff_user_id
LEFT JOIN school_users staff ON staff.school_id=ob.school_id AND staff.user_id=ob.staff_user_id
WHERE ob.status='PENDING_HEAD'
ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING;

INSERT INTO user_notifications
 (school_id,recipient_kind,recipient_id,event_key,category,title,body,
  request_type,request_id,status,action_url,created_at)
SELECT ob.school_id,'SCHOOL_USER',admin.user_id,
 'official-business:'||ob.request_id::text||':pending-admin',
 'APPROVAL','Official Business awaiting final approval',
 COALESCE(staff.display_name,'A staff member')||'''s OB request needs your final decision.',
 'OFFICIAL_BUSINESS',ob.request_id,'PENDING_ADMIN','/portal.html#officialBusiness',
 COALESCE(ob.head_decided_at,ob.submitted_at)
FROM staff_official_business_requests ob
JOIN school_users admin ON admin.school_id=ob.school_id AND admin.role='SCHOOL_ADMIN'
 AND admin.active=TRUE AND admin.user_id<>ob.staff_user_id
LEFT JOIN school_users staff ON staff.school_id=ob.school_id AND staff.user_id=ob.staff_user_id
WHERE ob.status='PENDING_ADMIN'
ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING;


-- Existing completed OB requests also appear in the requester's bell history.
-- Never create stale pending approval alerts after the request has been resolved.
INSERT INTO user_notifications
 (school_id,recipient_kind,recipient_id,event_key,category,title,body,
  request_type,request_id,status,action_url,created_at)
SELECT ob.school_id,'SCHOOL_USER',ob.staff_user_id,
 'official-business:'||ob.request_id::text||':final-'||lower(ob.status),
 'REQUEST',
 CASE ob.status WHEN 'APPROVED' THEN 'Official Business approved'
  WHEN 'REJECTED' THEN 'Official Business rejected'
  ELSE 'Official Business cancelled' END,
 CASE ob.status WHEN 'APPROVED' THEN 'Your OB request received final School Admin approval.'
  WHEN 'REJECTED' THEN 'Your OB request was rejected.'
  ELSE 'Your OB request was cancelled.' END,
 'OFFICIAL_BUSINESS',ob.request_id,ob.status,'/portal.html#officialBusiness',
 COALESCE(ob.admin_decided_at,ob.head_decided_at,ob.submitted_at)
FROM staff_official_business_requests ob
WHERE ob.status IN ('APPROVED','REJECTED','CANCELLED')
ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING;

-- Completed, admin-decided requests remain visible to the Department Head as
-- an informational status; there is no approval action attached to these.
INSERT INTO user_notifications
 (school_id,recipient_kind,recipient_id,event_key,category,title,body,
  request_type,request_id,status,action_url,created_at)
SELECT ob.school_id,'SCHOOL_USER',head.user_id,
 'official-business:'||ob.request_id::text||':department-final-'||lower(ob.status),
 'REQUEST',
 CASE ob.status WHEN 'APPROVED' THEN 'Official Business approved'
  WHEN 'REJECTED' THEN 'Official Business rejected'
  ELSE 'Official Business cancelled' END,
 COALESCE(staff.display_name,'A staff member')||'''s OB request: '||lower(ob.status)||'.',
 'OFFICIAL_BUSINESS',ob.request_id,ob.status,'/portal.html#officialBusiness',
 ob.admin_decided_at
FROM staff_official_business_requests ob
JOIN school_users head ON head.school_id=ob.school_id AND head.department_id=ob.department_id
 AND head.role='DEPARTMENT_HEAD' AND head.active=TRUE AND head.user_id<>ob.staff_user_id
LEFT JOIN school_users staff ON staff.school_id=ob.school_id AND staff.user_id=ob.staff_user_id
WHERE ob.status IN ('APPROVED','REJECTED') AND ob.admin_decided_at IS NOT NULL
ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING;
