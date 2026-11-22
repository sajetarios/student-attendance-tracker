-- Narrow indexes for high-value attendance exception review.
-- Avoid adding all 66 advisor-suggested indexes without query-plan evidence.
CREATE INDEX IF NOT EXISTS staff_ob_approved_staff_window_idx
  ON staff_official_business_requests (school_id,staff_user_id,starts_at,ends_at)
  WHERE status='APPROVED';
CREATE INDEX IF NOT EXISTS staff_gate_dtr_audit_evidence_idx
  ON staff_attendance_audit (school_id,(details->>'staffUserId'),(details->>'schoolDate'))
  WHERE action IN ('AUTO_GATE_TO_DTR_VERIFIED','ADMIN_GATE_TO_DTR_VERIFIED');
