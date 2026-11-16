-- Student portal account requests and approvals. Additive; keeps existing learners and logins.
CREATE TABLE IF NOT EXISTS student_account_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 student_id TEXT NOT NULL,
 requested_by_user_id UUID NOT NULL,
 request_type TEXT NOT NULL CHECK (request_type IN ('CREATE','RESET','ACTIVATE')),
 reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
 reviewed_by_user_id UUID,
 review_note TEXT,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT student_account_requests_learner_fk FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, student_id),
 CONSTRAINT student_account_requests_requester_fk FOREIGN KEY (school_id, requested_by_user_id) REFERENCES school_users(school_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_account_requests_one_pending
 ON student_account_requests(school_id,student_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS student_account_requests_school_status_date
 ON student_account_requests(school_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS student_account_requests_requester_date
 ON student_account_requests(school_id,requested_by_user_id,created_at DESC);
COMMENT ON TABLE student_account_requests IS
 'Teacher-origin student portal account requests; approved changes occur only after school admin review. Never stores credentials.';
