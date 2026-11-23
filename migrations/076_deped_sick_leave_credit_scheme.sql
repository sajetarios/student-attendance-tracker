-- 076: DepEd DO 013 s.2024 / CSC Sec.53: HR-authorized sick-leave treatment.
-- Additive only. Do not infer teaching leave scheme from application role.
CREATE TABLE IF NOT EXISTS staff_leave_credit_schemes (
 school_id UUID NOT NULL,
 staff_user_id UUID NOT NULL,
 leave_scheme TEXT NOT NULL CHECK(leave_scheme IN ('TEACHING_VSC','REGULAR_VL_SL')),
 hr_reference TEXT NOT NULL CHECK(length(btrim(hr_reference)) BETWEEN 3 AND 200),
 certified_by_user_id UUID NOT NULL,
 certified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,staff_user_id),
 CONSTRAINT staff_leave_scheme_employee_fk FOREIGN KEY(school_id,staff_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT staff_leave_scheme_officer_fk FOREIGN KEY(school_id,certified_by_user_id)
  REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
-- These records are accessed only through the authenticated school-scoped Express
-- backend, not Supabase Data API. Fail closed for direct anon/authenticated access.
ALTER TABLE staff_leave_credit_schemes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE ALL ON TABLE staff_leave_credit_schemes FROM anon;
 END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
  REVOKE ALL ON TABLE staff_leave_credit_schemes FROM authenticated;
 END IF;
END $$;

-- Preserve what was actually charged when a documented leave was approved;
-- never reconstruct it from an employee's current HR designation.
ALTER TABLE staff_form48_approved_leaves
 ADD COLUMN IF NOT EXISTS credit_account TEXT NOT NULL DEFAULT 'NONE'
 CHECK (credit_account IN ('NONE','VSC','VL','SL'));
-- Existing historic approval rows remain NONE (unverified historic charge).
ALTER TABLE staff_leave_requests
 ADD COLUMN IF NOT EXISTS filing_basis TEXT NOT NULL DEFAULT 'STANDARD'
 CHECK(filing_basis IN ('STANDARD','POST_RETURN','DURING_ABSENCE','ADVANCE'));

-- A notarized affidavit may substitute for medical consultation under
-- DepEd DO 013 s.2024 VI.C.4; storing it is NOT itself proof of notarization.
ALTER TABLE staff_leave_documents
 DROP CONSTRAINT IF EXISTS staff_leave_documents_document_kind_check;
ALTER TABLE staff_leave_documents
 ADD CONSTRAINT staff_leave_documents_document_kind_check
 CHECK(document_kind IN ('APPLICATION','MEDICAL','AFFIDAVIT','CERTIFICATION','APPROVAL','SPECIAL_ORDER','OTHER'));

COMMENT ON TABLE staff_leave_credit_schemes IS
 'Authenticated School HR-certified employee leave scheme. A teaching role is NOT conclusive proof of VSC entitlement. No automatic credit conversion or deduction.';
COMMENT ON COLUMN staff_leave_requests.filing_basis IS
 'Determined by Philippine-local filing date; post-return sick filing is allowed, pending approval and documented review.';
COMMENT ON COLUMN staff_form48_approved_leaves.credit_account IS
 'Credit account certified and actually charged in official approval. NONE is intentionally ambiguous for legacy approvals.';
