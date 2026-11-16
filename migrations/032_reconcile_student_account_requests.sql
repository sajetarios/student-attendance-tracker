-- Reconcile already-completed staff actions with older pending teacher requests.
-- Only use documented audit events AFTER the request; never infer password delivery.
WITH completed AS (
 SELECT DISTINCT ON (r.request_id)
  r.request_id,
  a.actor_user_id,
  a.created_at AS completed_at
 FROM student_account_requests r
 JOIN audit_logs a ON a.school_id=r.school_id
   AND a.created_at >= r.created_at
   AND a.details->>'studentId'=r.student_id
   AND (
      (r.request_type='CREATE' AND a.action IN ('SCHOOL_ADMIN_CREATE_STUDENT_PORTAL_LOGIN','SCHOOL_ADMIN_CREATE_STUDENT_LOGIN'))
      OR (r.request_type='RESET' AND a.action IN ('SCHOOL_ADMIN_RESET_STUDENT_PORTAL_LOGIN','SCHOOL_ADMIN_RESET_STUDENT_PASSWORD'))
      OR (r.request_type='ACTIVATE' AND a.action='SCHOOL_ADMIN_ACTIVATE_STUDENT_PORTAL_LOGIN')
   )
 WHERE r.status='PENDING'
 ORDER BY r.request_id,a.created_at ASC
)
UPDATE student_account_requests r
SET status='APPROVED',
    reviewed_by_user_id=c.actor_user_id,
    reviewed_at=c.completed_at,
    review_note='Request fulfilled previously by School Admin. Arrange secure delivery of the newly issued credentials.'
FROM completed c WHERE r.request_id=c.request_id AND r.status='PENDING';
