-- Durable missing-scan notifications in the same transaction as the request.
-- No modifications to DTR slots, evidence, or approval authority.
CREATE OR REPLACE FUNCTION attendigo_missing_scan_pending(p_school UUID,p_request UUID,p_reset BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; recipient RECORD; v_url TEXT;
BEGIN
 SELECT req.*,u.role AS requester_role,u.display_name AS requester_name
 INTO r FROM staff_missing_scan_requests req JOIN school_users u
 ON u.school_id=req.school_id AND u.user_id=req.staff_user_id
 WHERE req.school_id=p_school AND req.request_id=p_request;
 IF NOT FOUND OR r.status NOT IN ('PENDING_HEAD','HEAD_VERIFIED') THEN RETURN; END IF;
 FOR recipient IN SELECT u.user_id,u.role FROM school_users u
 WHERE u.school_id=r.school_id AND u.active=TRUE AND u.user_id<>r.staff_user_id
 AND ((r.requester_role='DEPARTMENT_HEAD' AND u.role='PRINCIPAL')
 OR (r.requester_role<>'DEPARTMENT_HEAD' AND u.role='DEPARTMENT_HEAD' AND u.department_id=r.department_id))
 LOOP
  v_url:=CASE WHEN recipient.role='PRINCIPAL' THEN '/principal.html#missingScans' ELSE '/portal.html#missingScans' END;
  PERFORM attendigo_notify(r.school_id,'SCHOOL_USER',recipient.user_id,
   'missing-scan:'||r.request_id::text||':review','APPROVAL','Missing scan awaiting review',
   COALESCE(NULLIF(r.requester_name,''),'A staff member')||' submitted a missing '||replace(r.slot,'_',' ')||' scan for '||r.school_date::text||'.',
   'MISSING_SCAN',r.request_id,r.status,v_url,p_reset);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION attendigo_missing_scan_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_key TEXT:='missing-scan:'||NEW.request_id::text; v_title TEXT; v_body TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 END IF;
 IF NEW.status IN ('PENDING_HEAD','HEAD_VERIFIED') THEN
  PERFORM attendigo_missing_scan_pending(NEW.school_id,NEW.request_id,TG_OP='UPDATE');
  IF TG_OP='INSERT' THEN
   PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,v_key||':submitted',
    'REQUEST','Missing scan request submitted','Your request is awaiting the authorized reviewer.',
    'MISSING_SCAN',NEW.request_id,NEW.status,'/portal.html#missingScans');
  END IF;
 ELSE
  -- Close the actionable approval for every recipient, not only the deciding reviewer.
  UPDATE user_notifications SET status=NEW.status,read_at=COALESCE(read_at,NOW()),updated_at=NOW()
   WHERE school_id=NEW.school_id AND request_type='MISSING_SCAN' AND request_id=NEW.request_id
   AND category='APPROVAL' AND event_key=v_key||':review';
  v_title:=CASE NEW.status WHEN 'NEEDS_EVIDENCE' THEN 'Missing scan needs clarification'
   WHEN 'DOCUMENTED' THEN 'Missing scan documented'
   WHEN 'DTR_CORRECTED' THEN 'Missing scan correction approved'
   ELSE 'Missing scan request rejected' END;
  v_body:=CASE NEW.status WHEN 'NEEDS_EVIDENCE' THEN 'Your reviewer needs additional evidence. Open your request to respond.'
   WHEN 'DOCUMENTED' THEN 'The exception was documented. The official DTR time remains blank under school policy.'
   WHEN 'DTR_CORRECTED' THEN 'The authorized correction was recorded in your DTR.'
   ELSE 'Your missing scan request was rejected. Open your request for the reviewer comment.' END;
  PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
   v_key||':decision','REQUEST',v_title,v_body,'MISSING_SCAN',NEW.request_id,NEW.status,
   '/portal.html#missingScans',TRUE);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS missing_scan_request_notification ON staff_missing_scan_requests;
CREATE TRIGGER missing_scan_request_notification AFTER INSERT OR UPDATE OF status ON staff_missing_scan_requests
 FOR EACH ROW EXECUTE FUNCTION attendigo_missing_scan_notification_trigger();

-- Backfill unresolved requests only. Existing alerts are not duplicated or marked unread again.
SELECT attendigo_missing_scan_pending(school_id,request_id)
FROM staff_missing_scan_requests WHERE status IN ('PENDING_HEAD','HEAD_VERIFIED');
