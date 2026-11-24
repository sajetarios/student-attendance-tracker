-- Durable notifications for the existing department attendance location workflow.
-- No coordinates or private evidence appear in notification content.
CREATE OR REPLACE FUNCTION attendigo_location_notify(p_school UUID,p_department UUID,p_proposal JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
 v_department TEXT; v_proposer UUID; v_status TEXT; v_key TEXT; v_admin RECORD;
BEGIN
 SELECT department_name INTO v_department FROM school_departments
 WHERE school_id=p_school AND department_id=p_department;
 IF NOT FOUND THEN RETURN; END IF;
 IF COALESCE(p_proposal->>'proposedBy','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   OR COALESCE(p_proposal->>'proposedAt','')='' THEN RETURN; END IF;
 v_proposer:=(p_proposal->>'proposedBy')::UUID;
 v_status:=p_proposal->>'status';
 v_key:='department-location:'||p_department::TEXT||':'||(p_proposal->>'proposedAt');
 IF v_status='PENDING' THEN
   FOR v_admin IN SELECT user_id FROM school_users WHERE school_id=p_school AND role='SCHOOL_ADMIN' AND active=TRUE LOOP
     PERFORM attendigo_notify(p_school,'SCHOOL_USER',v_admin.user_id,v_key||':pending','APPROVAL',
       'Department location awaiting approval',v_department||' submitted an attendance location for review.',
       'DEPARTMENT_LOCATION',p_department,'PENDING','/portal.html?view=lunchQrAdmin');
   END LOOP;
 ELSIF v_status IN ('APPROVED','REJECTED') THEN
   UPDATE user_notifications SET status=v_status,read_at=COALESCE(read_at,NOW()),updated_at=NOW()
     WHERE school_id=p_school AND recipient_kind='SCHOOL_USER' AND event_key=v_key||':pending';
   IF EXISTS(SELECT 1 FROM school_users WHERE school_id=p_school AND user_id=v_proposer AND active=TRUE) THEN
     PERFORM attendigo_notify(p_school,'SCHOOL_USER',v_proposer,v_key||':decision','REQUEST',
       'Department location '||lower(v_status),v_department||' attendance location was '||lower(v_status)||'.',
       'DEPARTMENT_LOCATION',p_department,v_status,'/portal.html?view=dashboard');
   END IF;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION attendigo_location_notification_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.setting_key ~* '^staff_lunch_geo_proposal_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   IF TG_OP='UPDATE' THEN
     IF NEW.setting_value IS NOT DISTINCT FROM OLD.setting_value THEN RETURN NEW; END IF;
   END IF;
   PERFORM attendigo_location_notify(NEW.school_id,regexp_replace(NEW.setting_key,'^staff_lunch_geo_proposal_','')::UUID,NEW.setting_value);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS department_location_notification ON school_settings;
CREATE TRIGGER department_location_notification AFTER INSERT OR UPDATE OF setting_value ON school_settings
 FOR EACH ROW EXECUTE FUNCTION attendigo_location_notification_trigger();
-- Existing unresolved requests should be visible without submitting GPS again.
SELECT attendigo_location_notify(school_id,regexp_replace(setting_key,'^staff_lunch_geo_proposal_','')::UUID,setting_value)
FROM school_settings
WHERE setting_key ~ '^staff_lunch_geo_proposal_[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
  AND setting_value->>'status'='PENDING';
