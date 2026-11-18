-- 057: Additive school-wide Form 48 defaults and documented approved leave ranges.
-- No DTR punches, legacy leave statuses, or historical reviews are modified.
CREATE TABLE IF NOT EXISTS staff_form48_school_defaults (
 school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
 workdays SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
 regular_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 saturday_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 verified_by_name TEXT NOT NULL DEFAULT '',
 verified_by_position TEXT NOT NULL DEFAULT '',
 approved_by_name TEXT NOT NULL DEFAULT '',
 approved_by_position TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 updated_by_user_id UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (school_id,updated_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CHECK (cardinality(workdays) BETWEEN 0 AND 7),
 CHECK (workdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
 CHECK (jsonb_typeof(regular_hours)='object' AND jsonb_typeof(saturday_hours)='object'),
 CHECK (length(verified_by_name)<=120 AND length(verified_by_position)<=120),
 CHECK (length(approved_by_name)<=120 AND length(approved_by_position)<=120),
 CHECK (revision>=1)
);
CREATE TABLE IF NOT EXISTS staff_form48_approved_leaves (
 leave_id UUID PRIMARY KEY,
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 staff_user_id UUID NOT NULL,
 leave_type TEXT NOT NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 approval_reference TEXT NOT NULL,
 recorded_by_user_id UUID NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 revoked_by_user_id UUID,
 FOREIGN KEY (school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY (school_id,recorded_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY (school_id,revoked_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CHECK (leave_type IN ('MATERNITY','PATERNITY','SICK','VACATION','OTHER')),
 CHECK (start_date<=end_date),
 CHECK (end_date-start_date<=366),
 CHECK (length(approval_reference) BETWEEN 3 AND 120)
);
CREATE INDEX IF NOT EXISTS staff_form48_approved_leaves_active
 ON staff_form48_approved_leaves(school_id,staff_user_id,start_date,end_date)
 WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_form48_approved_leaves_exact
 ON staff_form48_approved_leaves(school_id,staff_user_id,leave_type,start_date,end_date)
 WHERE revoked_at IS NULL;
COMMENT ON TABLE staff_form48_approved_leaves IS 'School Admin transcription of already authorized personnel leave; not an approval workflow or attendance punch.';
