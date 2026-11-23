-- 077: Principal leadership role. Additive: does not modify existing role holders,
-- DTR events, leave credits, attendance outcomes, or official approvals.
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_role_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_role_check
 CHECK (role = ANY (ARRAY[
  'SCHOOL_ADMIN'::TEXT, 'PRINCIPAL'::TEXT,
  'DEPARTMENT_HEAD'::TEXT, 'TEACHER'::TEXT,
  'GATE_KEEPER'::TEXT, 'PARENT'::TEXT
 ]));
-- Non-teacher designations remain empty under the existing role-specific check.
COMMENT ON CONSTRAINT school_users_role_check ON school_users IS
 'PRINCIPAL is a distinct school leadership account, not School Admin; its reporting permissions are enforced by principal overview routes.';
