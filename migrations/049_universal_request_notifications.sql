-- 049: durable, tenant-scoped in-app notifications. Additive; no learner or attendance changes.
CREATE TABLE IF NOT EXISTS user_notifications (
 notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID REFERENCES schools(school_id) ON DELETE CASCADE,
 recipient_kind TEXT NOT NULL CHECK(recipient_kind IN ('SCHOOL_USER','STUDENT','PLATFORM')),
 recipient_id UUID NOT NULL,
 event_key TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('REQUEST','APPROVAL','SYSTEM')),
 title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '',
 request_type TEXT,
 request_id UUID,
 status TEXT,
 action_url TEXT NOT NULL DEFAULT '',
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT user_notifications_owner_scope CHECK (
   (recipient_kind='PLATFORM' AND school_id IS NULL)
   OR (recipient_kind IN ('SCHOOL_USER','STUDENT') AND school_id IS NOT NULL)),
 CONSTRAINT user_notifications_event_unique UNIQUE(recipient_kind,recipient_id,event_key)
);
CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx
 ON user_notifications(recipient_kind,recipient_id,school_id,created_at DESC,notification_id DESC);
CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
 ON user_notifications(recipient_kind,recipient_id,school_id,created_at DESC) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION attendigo_notify(
 p_school UUID, p_kind TEXT, p_recipient UUID, p_event TEXT,
 p_category TEXT, p_title TEXT, p_body TEXT, p_request_type TEXT,
 p_request_id UUID, p_status TEXT, p_url TEXT, p_replace BOOLEAN DEFAULT FALSE
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF p_recipient IS NULL THEN RETURN; END IF;
 INSERT INTO user_notifications(school_id,recipient_kind,recipient_id,event_key,category,title,body,request_type,request_id,status,action_url)
 VALUES(p_school,p_kind,p_recipient,p_event,p_category,p_title,p_body,p_request_type,p_request_id,p_status,p_url)
 ON CONFLICT(recipient_kind,recipient_id,event_key) DO UPDATE
 SET title=EXCLUDED.title,body=EXCLUDED.body,status=EXCLUDED.status,
     updated_at=NOW(),read_at=CASE WHEN p_replace THEN NULL ELSE user_notifications.read_at END
 WHERE p_replace;
END $$;

-- These triggers run in the SAME transaction as the authoritative request mutation.
-- Failed/rolled-back approvals cannot produce notifications.
CREATE OR REPLACE FUNCTION attendigo_request_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 v_type TEXT; v_url TEXT; v_requester UUID; v_student UUID;
 v_admin RECORD; v_key TEXT; v_title TEXT; v_body TEXT; v_batch UUID;
 v_approved INT; v_rejected INT; v_pending INT; v_status TEXT; v_ref UUID; v_note TEXT;
BEGIN
 IF TG_TABLE_NAME='guardian_change_requests' THEN
   v_type:='Guardian change'; v_url:='/portal.html#guardians';
   v_requester:=NEW.requested_by_user_id;
 ELSIF TG_TABLE_NAME='student_account_requests' THEN
   v_type:='Student account'; v_url:='/portal.html#studentAccounts';
   v_requester:=NEW.requested_by_user_id;
 ELSIF TG_TABLE_NAME='special_program_change_requests' THEN
   v_type:='Special-program'; v_url:='/portal.html#specialPrograms';
   v_requester:=NEW.requested_by_user_id; v_batch:=NEW.batch_id;
 ELSIF TG_TABLE_NAME='profile_photo_requests' THEN
   v_type:='Profile photo'; v_url:='/portal.html#students';
   v_requester:=NEW.requested_by_user_id; v_student:=NEW.requested_by_student_account_id;
 ELSIF TG_TABLE_NAME='parent_student_links' THEN
   v_type:='Guardian verification'; v_url:='/parent-portal.html';
   v_requester:=NEW.parent_user_id;
 ELSE
   RETURN NEW;
 END IF;

 IF TG_TABLE_NAME='parent_student_links' THEN v_ref:=NEW.link_id;
 ELSE v_ref:=NEW.request_id; END IF;

 IF TG_OP='INSERT' THEN
   v_key:=CASE WHEN v_batch IS NULL THEN TG_TABLE_NAME||':'||v_ref::TEXT
           ELSE 'special-program-batch:'||v_batch::TEXT END;
   -- Parent links identify the workflow by link_id rather than request_id.
   IF TG_TABLE_NAME='parent_student_links' THEN v_key:='parent-link:'||NEW.link_id::TEXT; END IF;
   v_title:=v_type||' request submitted';
   v_body:='Your request has been submitted and is awaiting review.';
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_requester,v_key||':submitted',
     'REQUEST',v_title,v_body,v_type,v_ref,'PENDING',v_url);
   PERFORM attendigo_notify(NEW.school_id,'STUDENT',v_student,v_key||':submitted',
     'REQUEST',v_title,v_body,v_type,v_ref,'PENDING','/student-portal.html');
   IF NEW.status='PENDING' THEN
     FOR v_admin IN SELECT user_id FROM school_users
       WHERE school_id=NEW.school_id AND role='SCHOOL_ADMIN' AND active=TRUE LOOP
       PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_admin.user_id,
         v_key||':pending','APPROVAL',v_type||' awaiting review',
         'A new '||lower(v_type)||' request requires your decision.',
         v_type,v_ref,'PENDING',v_url);
     END LOOP;
   END IF;
 ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
   v_key:=CASE WHEN v_batch IS NULL THEN TG_TABLE_NAME||':'||v_ref::TEXT
            ELSE 'special-program-batch:'||v_batch::TEXT END;
   IF TG_TABLE_NAME='parent_student_links' THEN v_key:='parent-link:'||NEW.link_id::TEXT; END IF;
   v_status:=NEW.status;
   v_title:=v_type||' request '||lower(v_status);
   v_body:='Your request status changed to '||lower(v_status)||'.';
   IF TG_TABLE_NAME IN ('guardian_change_requests','student_account_requests',
                      'special_program_change_requests') THEN
     v_note:=NULLIF(btrim(NEW.review_note),'');
     IF v_note IS NOT NULL THEN v_body:=v_body||' Review note: '||left(v_note,300); END IF;
   END IF;
   IF v_batch IS NOT NULL THEN
     SELECT COUNT(*) FILTER(WHERE status='APPROVED'),
            COUNT(*) FILTER(WHERE status='REJECTED'),
            COUNT(*) FILTER(WHERE status='PENDING')
       INTO v_approved,v_rejected,v_pending
       FROM special_program_change_requests
       WHERE school_id=NEW.school_id AND batch_id=v_batch;
     v_status:=CASE WHEN v_pending>0 THEN 'PARTIALLY_REVIEWED'
               WHEN v_rejected>0 AND v_approved>0 THEN 'PARTIALLY_APPROVED'
               WHEN v_rejected>0 THEN 'REJECTED' ELSE 'APPROVED' END;
     v_title:='Special-program batch '||lower(replace(v_status,'_',' '));
     v_body:=format('%s approved, %s rejected, %s awaiting review.',v_approved,v_rejected,v_pending);
   END IF;
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_requester,
      v_key||':decision','REQUEST',v_title,v_body,v_type,v_ref,v_status,v_url,TRUE);
   PERFORM attendigo_notify(NEW.school_id,'STUDENT',v_student,
      v_key||':decision','REQUEST',v_title,v_body,v_type,v_ref,v_status,
      '/student-portal.html',TRUE);
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guardian_request_notification ON guardian_change_requests;
CREATE TRIGGER guardian_request_notification AFTER INSERT OR UPDATE OF status ON guardian_change_requests
FOR EACH ROW EXECUTE FUNCTION attendigo_request_notification_trigger();
DROP TRIGGER IF EXISTS student_account_request_notification ON student_account_requests;
CREATE TRIGGER student_account_request_notification AFTER INSERT OR UPDATE OF status ON student_account_requests
FOR EACH ROW EXECUTE FUNCTION attendigo_request_notification_trigger();
DROP TRIGGER IF EXISTS special_program_request_notification ON special_program_change_requests;
CREATE TRIGGER special_program_request_notification AFTER INSERT OR UPDATE OF status ON special_program_change_requests
FOR EACH ROW EXECUTE FUNCTION attendigo_request_notification_trigger();
DROP TRIGGER IF EXISTS photo_request_notification ON profile_photo_requests;
CREATE TRIGGER photo_request_notification AFTER INSERT OR UPDATE OF status ON profile_photo_requests
FOR EACH ROW EXECUTE FUNCTION attendigo_request_notification_trigger();
DROP TRIGGER IF EXISTS parent_link_notification ON parent_student_links;
CREATE TRIGGER parent_link_notification AFTER INSERT OR UPDATE OF status ON parent_student_links
FOR EACH ROW EXECUTE FUNCTION attendigo_request_notification_trigger();

-- Super Admin receives platform-level onboarding updates, not private school requests.
CREATE OR REPLACE FUNCTION attendigo_school_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE u RECORD; v_status TEXT;
BEGIN
 IF TG_OP='INSERT' THEN
   v_status:='CREATED';
 ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
   v_status:=CASE WHEN NEW.active THEN 'REACTIVATED' ELSE 'DEACTIVATED' END;
 ELSE RETURN NEW;
 END IF;
 FOR u IN SELECT user_id FROM platform_users WHERE active=TRUE LOOP
  PERFORM attendigo_notify(NULL,'PLATFORM',u.user_id,
      'school:'||NEW.school_id::TEXT||':'||v_status,'SYSTEM',
      'School '||lower(v_status), 'A school record was '||lower(v_status)||'.',
      'School',NULL,v_status,'/portal.html#platformSchools');
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS school_platform_notification ON schools;
CREATE TRIGGER school_platform_notification AFTER INSERT OR UPDATE OF active ON schools
FOR EACH ROW EXECUTE FUNCTION attendigo_school_notification_trigger();
