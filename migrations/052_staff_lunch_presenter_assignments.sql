-- Rotating QR presenter authorization is explicitly scoped to school, date and slot.
CREATE TABLE staff_lunch_presenter_assignments (
 assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 presenter_user_id UUID NOT NULL,
 school_date DATE NOT NULL,
 dtr_slot TEXT NOT NULL CHECK(dtr_slot IN ('AM_OUT','PM_IN')),
 assigned_by_user_id UUID NOT NULL,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 UNIQUE(school_id,assignment_id),
 FOREIGN KEY(school_id,presenter_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,assigned_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX staff_lunch_one_active_presenter_per_slot
 ON staff_lunch_presenter_assignments(school_id,school_date,dtr_slot)
 WHERE revoked_at IS NULL;
CREATE INDEX staff_lunch_presenter_lookup
 ON staff_lunch_presenter_assignments(school_id,presenter_user_id,school_date,dtr_slot)
 WHERE revoked_at IS NULL;
