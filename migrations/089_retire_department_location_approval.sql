-- Retire routine location approval without activating historical unverified submissions.
DROP TRIGGER IF EXISTS department_location_notification ON school_settings;
UPDATE user_notifications SET status='SUPERSEDED',read_at=COALESCE(read_at,NOW()),updated_at=NOW()
 WHERE request_type='DEPARTMENT_LOCATION' AND status='PENDING';
-- Existing active location keys, assignment rows, proposals and attendance events are preserved.

-- Bind grants and challenges to the department authorized at issuance, not the user's later department.
ALTER TABLE staff_lunch_presenter_assignments ADD COLUMN department_id UUID;
ALTER TABLE staff_attendance_challenges ADD COLUMN department_id UUID;
ALTER TABLE staff_lunch_presenter_assignments ADD CONSTRAINT staff_lunch_assignment_department_fk
 FOREIGN KEY (school_id,department_id) REFERENCES school_departments(school_id,department_id) ON DELETE RESTRICT;
ALTER TABLE staff_attendance_challenges ADD CONSTRAINT staff_lunch_challenge_department_fk
 FOREIGN KEY (school_id,department_id) REFERENCES school_departments(school_id,department_id) ON DELETE RESTRICT;
-- Restore only independently recorded department provenance, never guess from the user's current assignment.
UPDATE staff_lunch_presenter_assignments a SET department_id=d.department_id
FROM staff_attendance_audit au JOIN school_departments d ON d.school_id=au.school_id AND d.department_id::text=au.details->>'departmentId'
WHERE a.school_id=au.school_id AND a.assignment_id=au.target_id
 AND au.action='LUNCH_PRESENTER_ASSIGNED' AND au.target_type='LUNCH_PRESENTER_ASSIGNMENT';
-- Unknown or transferred grants stay in history but cannot authorize new codes.
UPDATE staff_lunch_presenter_assignments a SET revoked_at=NOW()
WHERE a.revoked_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM school_users u JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
 WHERE u.school_id=a.school_id AND u.user_id=a.presenter_user_id AND u.department_id=a.department_id
 AND u.active=TRUE AND u.role='TEACHER' AND d.active=TRUE AND d.department_code<>'UNASSIGNED');
-- Old short-lived bearer codes have no immutable department binding; require a fresh code at cutover.
UPDATE staff_attendance_challenges SET revoked_at=NOW() WHERE revoked_at IS NULL AND expires_at>NOW()-INTERVAL '90 seconds';
ALTER TABLE staff_lunch_presenter_assignments ADD CONSTRAINT staff_lunch_active_assignment_department CHECK (revoked_at IS NOT NULL OR department_id IS NOT NULL);
-- Historical challenges may have no department and expired rows remain intact.
CREATE OR REPLACE FUNCTION attendigo_revoke_lunch_on_staff_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.role IS DISTINCT FROM OLD.role OR (OLD.active AND NOT NEW.active) THEN
   UPDATE staff_lunch_presenter_assignments SET revoked_at=NOW()
    WHERE school_id=OLD.school_id AND presenter_user_id=OLD.user_id AND revoked_at IS NULL;
   UPDATE staff_attendance_challenges SET revoked_at=NOW()
    WHERE school_id=OLD.school_id AND presenter_user_id=OLD.user_id AND revoked_at IS NULL AND expires_at>NOW()-INTERVAL '90 seconds';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_lunch_revoke_on_staff_change AFTER UPDATE OF department_id,role,active ON school_users
 FOR EACH ROW EXECUTE FUNCTION attendigo_revoke_lunch_on_staff_change();
