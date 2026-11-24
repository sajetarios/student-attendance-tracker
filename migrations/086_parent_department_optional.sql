-- 086: Parent accounts are not staff and must not be assigned a teaching department.
-- Staff roles still require a valid school department, preserving existing permissions.
-- Additive role-aware repair for the 013 migration's blanket NOT NULL constraint.
ALTER TABLE school_users ALTER COLUMN department_id DROP NOT NULL;

ALTER TABLE school_users
  DROP CONSTRAINT IF EXISTS school_users_staff_department_required;

ALTER TABLE school_users
  ADD CONSTRAINT school_users_staff_department_required
  CHECK (role = 'PARENT' OR department_id IS NOT NULL);

COMMENT ON COLUMN school_users.department_id IS
  'Required for staff roles; optional for PARENT accounts. Tenant-scoped foreign key remains in force.';
