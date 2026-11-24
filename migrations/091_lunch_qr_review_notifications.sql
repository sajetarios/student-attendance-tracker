-- Durable notifications only for actual lunch QR redemptions.
-- The same transaction records both the attendance evidence and its notification.
CREATE OR REPLACE FUNCTION attendigo_lunch_review_pending(p_school UUID,p_event UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e RECORD; recipient RECORD;
BEGIN
 SELECT a.event_id,a.staff_user_id,a.school_date,a.dtr_slot,u.role,u.department_id,u.display_name
 INTO e FROM staff_attendance_events a
 JOIN school_users u ON u.school_id=a.school_id AND u.user_id=a.staff_user_id
 WHERE a.school_id=p_school AND a.event_id=p_event
 AND a.event_kind='DTR_SLOT' AND a.source='SELF_SERVICE'
 AND a.verification_status='PENDING_VERIFICATION' AND a.dtr_slot IN ('AM_OUT','PM_IN')
 AND EXISTS(SELECT 1 FROM staff_attendance_challenge_redemptions r WHERE r.school_id=a.school_id AND r.event_id=a.event_id);
 IF NOT FOUND THEN RETURN; END IF;
 FOR recipient IN SELECT h.user_id,h.role FROM school_users h
 WHERE h.school_id=p_school AND h.active AND h.user_id<>e.staff_user_id
 AND ((e.role='TEACHER' AND h.role='DEPARTMENT_HEAD' AND h.department_id=e.department_id)
 OR (e.role='DEPARTMENT_HEAD' AND h.role='PRINCIPAL'))
 LOOP
  PERFORM attendigo_notify(p_school,'SCHOOL_USER',recipient.user_id,
   'lunch-review:'||p_event::text||':pending','APPROVAL','Lunch QR scan awaiting review',
   COALESCE(NULLIF(e.display_name,''),'Staff member')||' · '||e.school_date::text||' · '||replace(e.dtr_slot,'_',' '),
   'LUNCH_QR_REVIEW',p_event,'PENDING_VERIFICATION',
   CASE WHEN recipient.role='PRINCIPAL' THEN '/principal.html#priorities' ELSE '/portal.html?view=lunchQrAdmin' END);
 END LOOP;
 PERFORM attendigo_notify(p_school,'SCHOOL_USER',e.staff_user_id,
  'lunch-review:'||p_event::text||':submitted','REQUEST','Lunch QR scan requires review',
  'The scan is recorded as pending evidence, not a verified DTR punch.','LUNCH_QR_REVIEW',p_event,
  'PENDING_VERIFICATION','/portal.html?view=myGateAttendance');
END $$;
CREATE OR REPLACE FUNCTION attendigo_lunch_redemption_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM attendigo_lunch_review_pending(NEW.school_id,NEW.event_id);
 RETURN NEW;
END $$;
CREATE TRIGGER lunch_redemption_notification AFTER INSERT ON staff_attendance_challenge_redemptions
 FOR EACH ROW EXECUTE FUNCTION attendigo_lunch_redemption_notify();

CREATE OR REPLACE FUNCTION attendigo_lunch_review_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.verification_status<>'PENDING_VERIFICATION' OR NEW.verification_status NOT IN ('VERIFIED','REJECTED')
 OR NEW.source<>'SELF_SERVICE' OR NEW.event_kind<>'DTR_SLOT'
 OR NOT EXISTS(SELECT 1 FROM staff_attendance_challenge_redemptions r WHERE r.school_id=NEW.school_id AND r.event_id=NEW.event_id)
 THEN RETURN NEW; END IF;
 UPDATE user_notifications SET status=NEW.verification_status,read_at=COALESCE(read_at,NOW()),updated_at=NOW()
 WHERE school_id=NEW.school_id AND request_type='LUNCH_QR_REVIEW' AND request_id=NEW.event_id AND category='APPROVAL';
 PERFORM attendigo_notify(NEW.school_id,'SCHOOL_USER',NEW.staff_user_id,
 'lunch-review:'||NEW.event_id::text||':decision','REQUEST',
 CASE WHEN NEW.verification_status='VERIFIED' THEN 'Lunch QR scan verified' ELSE 'Lunch QR scan rejected' END,
 CASE WHEN NEW.verification_status='VERIFIED' THEN 'Your authorized reviewer verified the recorded lunch scan.' ELSE 'Your recorded lunch scan was rejected. Contact your authorized reviewer.' END,
 'LUNCH_QR_REVIEW',NEW.event_id,NEW.verification_status,'/portal.html?view=myGateAttendance',TRUE);
 RETURN NEW;
END $$;
CREATE TRIGGER lunch_review_notification AFTER UPDATE OF verification_status ON staff_attendance_events
 FOR EACH ROW EXECUTE FUNCTION attendigo_lunch_review_notify();

-- Only unresolved, recent, actual lunch QR redemptions are backfilled.
SELECT attendigo_lunch_review_pending(e.school_id,e.event_id)
FROM staff_attendance_events e
WHERE e.source='SELF_SERVICE' AND e.event_kind='DTR_SLOT' AND e.verification_status='PENDING_VERIFICATION'
 AND e.dtr_slot IN ('AM_OUT','PM_IN')
 AND e.school_date>=((NOW() AT TIME ZONE 'Asia/Manila')::date-7)
 AND EXISTS(SELECT 1 FROM staff_attendance_challenge_redemptions r WHERE r.school_id=e.school_id AND r.event_id=e.event_id);

-- Internal notification functions are invoked only by the server's transactions.
REVOKE ALL ON FUNCTION attendigo_lunch_review_pending(UUID,UUID),attendigo_lunch_redemption_notify(),attendigo_lunch_review_notify() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION attendigo_lunch_review_pending(UUID,UUID),attendigo_lunch_redemption_notify(),attendigo_lunch_review_notify() FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION attendigo_lunch_review_pending(UUID,UUID),attendigo_lunch_redemption_notify(),attendigo_lunch_review_notify() FROM authenticated; END IF;
END $$;
