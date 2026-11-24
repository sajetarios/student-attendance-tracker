-- 083: Department Head may decline internally without issuing an official leave disapproval.
-- This terminal workflow status is not an approved/excused absence, a deduction, or an official CSC Form 6 decision.
-- Existing audited requests are reconciled separately after deployment; no history is rewritten here.
ALTER TABLE staff_leave_requests DROP CONSTRAINT IF EXISTS staff_leave_requests_status_check;
ALTER TABLE staff_leave_requests ADD CONSTRAINT staff_leave_requests_status_check
 CHECK (status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL','APPROVED','REJECTED','CANCELLED','DECLINED_HEAD'));
COMMENT ON COLUMN staff_leave_requests.status IS
 'DECLINED_HEAD means department did not endorse the request and internal routing stops; REJECTED remains exclusively a verified official disapproval.';
