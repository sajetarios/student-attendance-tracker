-- Completion is distinct from the signed original OB authorization and all gate/DTR punches.
ALTER TABLE staff_official_business_requests
 ADD COLUMN completion_status text,
 ADD COLUMN completion_at timestamptz,
 ADD COLUMN completion_reason text,
 ADD COLUMN completion_reference text,
 ADD COLUMN completion_submitted_at timestamptz,
 ADD COLUMN completion_head_note text,
 ADD COLUMN completion_decision_note text,
 ADD COLUMN completion_decided_at timestamptz,
 ADD CONSTRAINT staff_ob_completion_status_check CHECK (
  (completion_status IS NULL AND completion_at IS NULL AND completion_reference IS NULL)
  OR (status='APPROVED' AND completion_status IN ('PENDING_HEAD','PENDING_PRINCIPAL','VERIFIED','REJECTED')
      AND completion_at IS NOT NULL AND completion_at>=starts_at
      AND completion_at<=starts_at+INTERVAL '14 days' AND length(trim(completion_reference))>0));
CREATE INDEX staff_ob_completion_review_idx ON staff_official_business_requests(school_id,department_id,completion_status)
 WHERE completion_status IN ('PENDING_HEAD','PENDING_PRINCIPAL');
COMMENT ON COLUMN staff_official_business_requests.completion_at IS 'Actual completion claimed by employee; official only after completion_status VERIFIED. Not a gate or DTR clock punch.';
