-- 058: Employee-level persistent prescribed office hours, independent of Form 48 preview.
-- Additive only. Never modify staff attendance events, monthly review decisions or OB evidence.
CREATE TABLE IF NOT EXISTS staff_form48_employee_schedules (
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 staff_user_id UUID NOT NULL,
 workdays SMALLINT[] NOT NULL,
 regular_hours JSONB NOT NULL,
 saturday_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_by_user_id UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (school_id,staff_user_id),
 FOREIGN KEY (school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY (school_id,updated_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CHECK (cardinality(workdays) BETWEEN 1 AND 7),
 CHECK (workdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
 CHECK (jsonb_typeof(regular_hours)='object'),
 CHECK (jsonb_typeof(saturday_hours)='object'),
 CHECK (revision>=1)
);
COMMENT ON TABLE staff_form48_employee_schedules IS
 'School Admin-maintained employee prescribed hours used as Form 48 defaults across months. Actual verified punches and past monthly review decisions are never changed.';
