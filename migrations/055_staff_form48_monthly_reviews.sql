-- 055: School Admin-reviewed monthly Form 48 work-hour rules and draft signatory names.
-- Never changes immutable DTR punch events or asserts that typing a name is a signature.
CREATE TABLE IF NOT EXISTS staff_form48_monthly_reviews (
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 staff_user_id UUID NOT NULL,
 report_month DATE NOT NULL,
 workdays SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
 regular_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 saturday_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 day_reviews JSONB NOT NULL DEFAULT '{}'::jsonb,
 verified_by_name TEXT NOT NULL DEFAULT '',
 approved_by_name TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 updated_by_user_id UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (school_id,staff_user_id,report_month),
 FOREIGN KEY (school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY (school_id,updated_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CHECK (report_month=DATE_TRUNC('month',report_month)::date),
 CHECK (cardinality(workdays) BETWEEN 0 AND 7),
 CHECK (workdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
 CHECK (jsonb_typeof(regular_hours)='object'),
 CHECK (jsonb_typeof(saturday_hours)='object'),
 CHECK (jsonb_typeof(day_reviews)='object'),
 CHECK (length(verified_by_name)<=120 AND length(approved_by_name)<=120),
 CHECK (revision>=1)
);
CREATE INDEX IF NOT EXISTS staff_form48_monthly_reviews_updated
 ON staff_form48_monthly_reviews(school_id,updated_at);
COMMENT ON TABLE staff_form48_monthly_reviews IS
 'Admin-controlled monthly draft rules and printed names, not a digital approval. Confirmed absence/excusal decisions are audited in staff_attendance_audit.';
