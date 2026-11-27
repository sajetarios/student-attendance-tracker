-- Explicit half-day sessions. Historical approvals retain FULL; no credit/punch backfill.
ALTER TABLE staff_leave_requests ADD COLUMN leave_session text NOT NULL DEFAULT 'FULL'
 CHECK(leave_session IN ('FULL','AM','PM')),
 ADD CONSTRAINT staff_leave_request_partial_check CHECK(leave_session='FULL' OR
 (start_date=end_date AND leave_type IN ('SICK','VACATION','VSC') AND
 (status<>'APPROVED' OR certified_working_days=0.5)));
ALTER TABLE staff_form48_approved_leaves ADD COLUMN leave_session text NOT NULL DEFAULT 'FULL',
 ADD COLUMN session_start time, ADD COLUMN session_end time,
 ADD CONSTRAINT staff_form48_leave_session_check CHECK(
 (leave_session='FULL' AND session_start IS NULL AND session_end IS NULL) OR
 (leave_session IN ('AM','PM') AND start_date=end_date AND session_start IS NOT NULL
 AND session_end IS NOT NULL AND session_start<session_end));
DROP INDEX IF EXISTS staff_form48_approved_leaves_exact;
CREATE UNIQUE INDEX staff_form48_approved_leaves_exact
 ON staff_form48_approved_leaves(school_id,staff_user_id,leave_type,start_date,end_date,leave_session)
 WHERE revoked_at IS NULL;
ALTER TABLE staff_leave_documents DROP CONSTRAINT staff_leave_documents_document_kind_check;
ALTER TABLE staff_leave_documents ADD CONSTRAINT staff_leave_documents_document_kind_check
 CHECK(document_kind IN ('APPLICATION','MEDICAL','AFFIDAVIT','CERTIFICATION','APPROVAL','SPECIAL_ORDER','OTHER','REVISION'));
CREATE TABLE staff_leave_revisions (
 revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id uuid NOT NULL, request_id uuid NOT NULL, document_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, prior_revision integer NOT NULL,
 decision text NOT NULL CHECK(decision IN ('CANCEL','SHORTEN')),
 previous_record jsonb NOT NULL, replacement_record jsonb NOT NULL,
 approval_reference text NOT NULL CHECK(length(trim(approval_reference)) BETWEEN 3 AND 120),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 restored_days numeric(9,3) NOT NULL CHECK(restored_days>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,request_id,prior_revision), UNIQUE(school_id,document_id),
 FOREIGN KEY(school_id,request_id) REFERENCES staff_leave_requests(school_id,request_id),
 FOREIGN KEY(school_id,document_id) REFERENCES staff_leave_documents(school_id,document_id),
 FOREIGN KEY(school_id,actor_user_id) REFERENCES school_users(school_id,user_id)
);
ALTER TABLE staff_leave_revisions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE staff_leave_revisions FROM anon;
 END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE staff_leave_revisions FROM authenticated;
 END IF;
END $$;
