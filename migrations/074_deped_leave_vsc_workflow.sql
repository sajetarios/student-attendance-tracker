-- 074: Additive DepEd leave requests and independently certified credit ledgers.
-- Does not change, rewrite, or infer physical gate events, DTR slots or OB.
CREATE TABLE IF NOT EXISTS staff_leave_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 staff_user_id UUID NOT NULL,
 department_id UUID NOT NULL,
 leave_type TEXT NOT NULL CHECK (leave_type IN
  ('VACATION','SICK','MATERNITY','PATERNITY','SPECIAL_PRIVILEGE','WELLNESS','VSC','OTHER')),
 credit_account TEXT NOT NULL CHECK (credit_account IN ('VSC','VL','SL','NONE')),
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
 details TEXT NOT NULL DEFAULT '' CHECK (length(details)<=1500),
 commutation TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
  CHECK (commutation IN ('NOT_REQUESTED','REQUESTED')),
 status TEXT NOT NULL DEFAULT 'PENDING_HEAD'
  CHECK (status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL','APPROVED','REJECTED','CANCELLED')),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 head_user_id UUID, head_decided_at TIMESTAMPTZ, head_note TEXT,
 admin_user_id UUID, admin_reviewed_at TIMESTAMPTZ, admin_note TEXT,
 certified_working_days NUMERIC(8,3),
 external_reference TEXT, external_approver TEXT, external_approver_position TEXT,
 external_approved_on DATE, verified_by_user_id UUID, verified_at TIMESTAMPTZ,
 form48_leave_id UUID, revision INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT staff_leave_date_span CHECK (start_date<=end_date AND end_date-start_date<=366),
 CONSTRAINT staff_leave_school_id_unique UNIQUE(school_id,request_id),
 CONSTRAINT staff_leave_staff_fk FOREIGN KEY (school_id,staff_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_department_fk FOREIGN KEY(school_id,department_id)
  REFERENCES school_departments(school_id,department_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_head_fk FOREIGN KEY(school_id,head_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_admin_fk FOREIGN KEY(school_id,admin_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_verifier_fk FOREIGN KEY(school_id,verified_by_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_final_evidence CHECK
  (status<>'APPROVED' OR (external_reference IS NOT NULL AND external_approver IS NOT NULL
    AND external_approver_position IS NOT NULL AND external_approved_on IS NOT NULL
    AND verified_by_user_id IS NOT NULL AND certified_working_days>0
    AND form48_leave_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_leave_request_staff_idx
 ON staff_leave_requests(school_id,staff_user_id,submitted_at DESC);
CREATE INDEX IF NOT EXISTS staff_leave_request_department_idx
 ON staff_leave_requests(school_id,department_id,status,submitted_at DESC);
CREATE TABLE IF NOT EXISTS staff_leave_credit_entries (
 credit_entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 staff_user_id UUID NOT NULL,
 credit_account TEXT NOT NULL CHECK (credit_account IN ('VSC','VL','SL','CTO')),
 entry_kind TEXT NOT NULL CHECK (entry_kind IN ('OPENING','EARNED','USED','ADJUSTMENT')),
 signed_days NUMERIC(9,3) NOT NULL CHECK (signed_days<>0 AND abs(signed_days)<=1000),
 activity_kind TEXT NOT NULL DEFAULT 'OTHER'
  CHECK(activity_kind IN ('SEMINAR','BRIGADA_ESKWELA','TEACHING_OVERLOAD','OTHER')),
 activity_date DATE, hours NUMERIC(8,2) CHECK (hours IS NULL OR hours BETWEEN 0 AND 1000),
 policy_reference TEXT NOT NULL DEFAULT '',
 approval_reference TEXT NOT NULL DEFAULT '',
 request_id UUID,
 status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','VERIFIED','VOID')),
 entered_by_user_id UUID NOT NULL,
 verified_by_user_id UUID,
 verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=1500),
 CONSTRAINT staff_leave_credits_school_entry_uk UNIQUE(school_id,credit_entry_id),
 CONSTRAINT staff_leave_credits_staff_fk FOREIGN KEY(school_id,staff_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_credits_entered_fk FOREIGN KEY(school_id,entered_by_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_credits_verified_fk FOREIGN KEY(school_id,verified_by_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_credits_request_fk FOREIGN KEY(school_id,request_id)
  REFERENCES staff_leave_requests(school_id,request_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_credits_sign CHECK
  ((entry_kind IN ('OPENING','EARNED') AND signed_days>0) OR
   (entry_kind='USED' AND signed_days<0) OR entry_kind='ADJUSTMENT'),
 CONSTRAINT staff_leave_credits_usage CHECK(entry_kind<>'USED' OR (request_id IS NOT NULL AND status='VERIFIED')),
 CONSTRAINT staff_leave_credits_certified CHECK
  (status<>'VERIFIED' OR
   (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL
    AND length(btrim(approval_reference))>=3))
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_credit_once_per_leave
 ON staff_leave_credit_entries(school_id,request_id,credit_account)
 WHERE entry_kind='USED';
CREATE INDEX IF NOT EXISTS staff_leave_credit_balance_idx
 ON staff_leave_credit_entries(school_id,staff_user_id,credit_account,status);
-- Preserve existing leave recording and enhance its typed DTR label without touching punches.
ALTER TABLE staff_form48_approved_leaves
 DROP CONSTRAINT IF EXISTS staff_form48_approved_leaves_leave_type_check;
ALTER TABLE staff_form48_approved_leaves ADD CONSTRAINT staff_form48_approved_leaves_leave_type_check
 CHECK (leave_type IN ('MATERNITY','PATERNITY','SICK','VACATION','OTHER','VSC','WELLNESS','SPECIAL_PRIVILEGE'));
COMMENT ON TABLE staff_leave_requests IS
 'DepEd staged leave requests, external approval verification, and eventual documented Form48 annotation; not an attendance event.';
COMMENT ON TABLE staff_leave_credit_entries IS
 'Proposed credits do not count toward balances. Verified credits require an official approval reference; entries never create QR events.';

-- Supporting documents stay in protected database storage, never /public or static assets.
CREATE TABLE IF NOT EXISTS staff_leave_documents (
 document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 request_id UUID,
 credit_entry_id UUID,
 uploaded_by_user_id UUID NOT NULL,
 document_kind TEXT NOT NULL CHECK(document_kind IN
  ('APPLICATION','MEDICAL','CERTIFICATION','APPROVAL','SPECIAL_ORDER','OTHER')),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),
 content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
 content BYTEA NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 4194304),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT staff_leave_document_one_subject CHECK((request_id IS NOT NULL) <> (credit_entry_id IS NOT NULL)),
 CONSTRAINT staff_leave_document_request_fk FOREIGN KEY(school_id,request_id)
  REFERENCES staff_leave_requests(school_id,request_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_document_credit_fk FOREIGN KEY(school_id,credit_entry_id)
  REFERENCES staff_leave_credit_entries(school_id,credit_entry_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_document_uploader_fk FOREIGN KEY(school_id,uploaded_by_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 UNIQUE(school_id,document_id)
);
CREATE INDEX IF NOT EXISTS staff_leave_documents_request_idx
 ON staff_leave_documents(school_id,request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_leave_documents_credit_idx
 ON staff_leave_documents(school_id,credit_entry_id) WHERE credit_entry_id IS NOT NULL;
