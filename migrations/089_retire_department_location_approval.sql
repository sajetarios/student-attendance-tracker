-- Retire routine location approval without activating historical unverified submissions.
DROP TRIGGER IF EXISTS department_location_notification ON school_settings;
UPDATE user_notifications SET status='SUPERSEDED',read_at=COALESCE(read_at,NOW()),updated_at=NOW()
 WHERE request_type='DEPARTMENT_LOCATION' AND status='PENDING';
-- Existing active location keys, assignment rows, proposals and attendance events are preserved.
