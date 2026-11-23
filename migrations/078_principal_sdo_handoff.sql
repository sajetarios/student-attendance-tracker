-- 078: Principal SDO handoff ledger, without altering historical attendance or approvals.
-- Principal OB may be filed without an instructional department; external decision evidence
-- and school-local authorizations remain separate from any physical gate scan.
ALTER TABLE staff_official_business_requests ALTER COLUMN department_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS principal_sdo_handoffs (
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('LEAVE','OB')),
 request_id UUID NOT NULL,
 principal_user_id UUID NOT NULL,
 submitted_at TIMESTAMPTZ,
 submitted_by_user_id UUID,
 submission_channel TEXT CHECK(submission_channel IN ('OFFICIAL_EMAIL','SDO_TRACKING','PHYSICAL','OTHER')),
 receiving_office TEXT CHECK(receiving_office IS NULL OR length(receiving_office) BETWEEN 3 AND 180),
 submission_reference TEXT CHECK(submission_reference IS NULL OR length(submission_reference) BETWEEN 3 AND 160),
 decision TEXT CHECK(decision IN ('APPROVED','REJECTED')),
 decision_reference TEXT,
 approver_name TEXT,
 approver_position TEXT,
 decision_date DATE,
 decision_recorded_at TIMESTAMPTZ,
 decision_recorded_by UUID,
 signed_filename TEXT,
 signed_content_type TEXT CHECK(signed_content_type IN ('application/pdf','image/png','image/jpeg')),
 signed_document BYTEA,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (school_id,kind,request_id),
 FOREIGN KEY(school_id,principal_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,submitted_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,decision_recorded_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT principal_sdo_handoff_required CHECK
  ((submitted_at IS NULL AND submitted_by_user_id IS NULL AND submission_reference IS NULL AND receiving_office IS NULL AND submission_channel IS NULL) OR
   (submitted_at IS NOT NULL AND submitted_by_user_id IS NOT NULL AND submission_reference IS NOT NULL AND receiving_office IS NOT NULL AND submission_channel IS NOT NULL)),
 CONSTRAINT principal_sdo_final_required CHECK
  (decision IS NULL OR (submitted_at IS NOT NULL AND decision_reference IS NOT NULL AND approver_name IS NOT NULL AND
   approver_position IS NOT NULL AND decision_date IS NOT NULL AND decision_recorded_at IS NOT NULL AND
   decision_recorded_by IS NOT NULL AND signed_document IS NOT NULL AND signed_filename IS NOT NULL)),
 CONSTRAINT principal_sdo_doc_size CHECK(signed_document IS NULL OR octet_length(signed_document) BETWEEN 1 AND 4194304)
);
CREATE INDEX IF NOT EXISTS principal_sdo_queue_idx ON principal_sdo_handoffs(school_id,submitted_at,decision_recorded_at);
COMMENT ON TABLE principal_sdo_handoffs IS
 'Records school handoff to SDO and the signed external decision. School staff do not act as the external approving officer.';

-- Notification messages for principal OB must not falsely say a School Admin granted approval.
CREATE OR REPLACE FUNCTION attendigo_ob_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
 v_recipient RECORD;
 v_requester_name TEXT;
 v_requester_role TEXT;
 v_key TEXT := 'official-business:' || NEW.request_id::text;
 v_url TEXT := '/portal.html#officialBusiness';
 v_title TEXT;
 v_body TEXT;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT display_name,role INTO v_requester_name,v_requester_role
 FROM school_users WHERE school_id=NEW.school_id AND user_id=NEW.staff_user_id;
 v_requester_name := COALESCE(NULLIF(v_requester_name,''),'A staff member');
 IF v_requester_role='PRINCIPAL' THEN
   v_url:='/principal.html';
   IF TG_OP='INSERT' THEN
    PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
      v_key||':submitted','REQUEST','Principal OB request filed',
      'Awaiting school coordination and documented SDO decision.',
      'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
   END IF;
   IF NEW.status='PENDING_ADMIN' THEN
    FOR v_recipient IN SELECT user_id FROM school_users WHERE school_id=NEW.school_id
      AND role='SCHOOL_ADMIN' AND active AND user_id<>NEW.staff_user_id LOOP
      PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
       v_key||':pending-sdo','APPROVAL','Principal OB requires SDO coordination',
       'Record the external submission and signed official decision; do not self-approve.',
       'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,'/principal.html');
    END LOOP;
   ELSIF NEW.status IN ('APPROVED','REJECTED') THEN
    PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
      v_key||':external-'||lower(NEW.status),'REQUEST','Principal OB external decision recorded',
      'An authorized school officer recorded a documented SDO decision.',
      'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
   END IF;
   RETURN NEW;
 END IF;
 -- Preserve the original ordinary staff OB notification semantics.
 IF TG_OP='INSERT' THEN
  PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
    v_key||':submitted','REQUEST','Official Business request submitted',
    'Your OB request is awaiting Department Head recommendation.',
    'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_HEAD',v_url);
 END IF;
 IF NEW.status='PENDING_HEAD' THEN
  FOR v_recipient IN SELECT user_id FROM school_users
   WHERE school_id=NEW.school_id AND department_id=NEW.department_id
    AND role='DEPARTMENT_HEAD' AND active AND user_id<>NEW.staff_user_id LOOP
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
  FOR v_recipient IN SELECT user_id FROM school_users WHERE school_id=NEW.school_id
    AND role='SCHOOL_ADMIN' AND active AND user_id<>NEW.staff_user_id LOOP
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
     v_key||':pending-admin','APPROVAL','Official Business awaiting final approval',
     v_requester_name||'''s OB request needs your final decision.',
     'OFFICIAL_BUSINESS',NEW.request_id,'PENDING_ADMIN',v_url);
  END LOOP;
 ELSIF NEW.status IN ('APPROVED','REJECTED','CANCELLED') THEN
  v_title:=CASE NEW.status WHEN 'APPROVED' THEN 'Official Business approved'
   WHEN 'REJECTED' THEN 'Official Business rejected' ELSE 'Official Business cancelled' END;
  v_body:=CASE NEW.status WHEN 'APPROVED' THEN 'Your OB request received final School Admin approval.'
   WHEN 'REJECTED' THEN 'Your OB request was rejected.' ELSE 'Your OB request was cancelled.' END;
  IF NEW.decision_note IS NOT NULL AND btrim(NEW.decision_note)<>'' THEN
    v_body:=v_body||' Note: '||left(btrim(NEW.decision_note),300);
  END IF;
  PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
   v_key||':final-'||lower(NEW.status),'REQUEST',v_title,v_body,
   'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
  IF NEW.admin_decided_at IS NOT NULL THEN
   FOR v_recipient IN SELECT user_id FROM school_users
    WHERE school_id=NEW.school_id AND department_id=NEW.department_id
     AND role='DEPARTMENT_HEAD' AND active AND user_id<>NEW.staff_user_id LOOP
    PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',v_recipient.user_id,
     v_key||':department-final-'||lower(NEW.status),'REQUEST',v_title,
     v_requester_name||'''s OB request: '||lower(NEW.status)||'.',
     'OFFICIAL_BUSINESS',NEW.request_id,NEW.status,v_url);
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
