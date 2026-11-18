-- Allow multiple independently authorized lunch QR presenters across departments.
-- Preserve all existing assignments, challenge history, audit rows and DTR events.
DROP INDEX IF EXISTS staff_lunch_one_active_presenter_per_slot;

-- An active presenter is unique only within their own school/day/DTR slot.
-- Department membership is read from school_users at authorization time.
CREATE UNIQUE INDEX staff_lunch_one_active_assignment_per_teacher_slot
 ON staff_lunch_presenter_assignments(school_id,school_date,dtr_slot,presenter_user_id)
 WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_lunch_active_presenters_by_slot
 ON staff_lunch_presenter_assignments(school_id,school_date,dtr_slot)
 WHERE revoked_at IS NULL;

COMMENT ON TABLE staff_lunch_presenter_assignments IS
 'Multiple teachers per department may present independent rotating QR challenges. School Admin grants and revokes each teacher; one active grant per teacher per date and slot.';
