-- Special-program change requests, school-scoped approval workflow.
-- Original student identities, enrollments, attendance and prior program records remain unchanged.
CREATE TABLE IF NOT EXISTS special_program_change_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  school_year_id UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  requested_program_type_id UUID,
  action TEXT NOT NULL CHECK (action IN ('ASSIGN','REMOVE')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by_user_id UUID NOT NULL,
  reviewed_by_user_id UUID,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT program_request_enrollment_fk FOREIGN KEY (school_id,enrollment_id,student_id,school_year_id)
    REFERENCES student_enrollments(school_id,enrollment_id,student_id,school_year_id),
  CONSTRAINT program_request_type_fk FOREIGN KEY (school_id,requested_program_type_id)
    REFERENCES special_program_types(school_id,program_type_id),
  CONSTRAINT program_request_requester_fk FOREIGN KEY (school_id,requested_by_user_id)
    REFERENCES school_users(school_id,user_id),
  CONSTRAINT program_request_reviewer_fk FOREIGN KEY (school_id,reviewed_by_user_id)
    REFERENCES school_users(school_id,user_id),
  CONSTRAINT program_request_action_type CHECK (
    (action='ASSIGN' AND requested_program_type_id IS NOT NULL)
    OR (action='REMOVE' AND requested_program_type_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS special_program_one_pending_per_learner_year
  ON special_program_change_requests(school_id,student_id,school_year_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS special_program_requests_school_status
  ON special_program_change_requests(school_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS special_program_requests_author
  ON special_program_change_requests(school_id,requested_by_user_id,created_at DESC);
