-- 075: Principals / administrators may not belong to a teaching department.
-- The original Leave Request schema (074) required department_id for every applicant.
-- Relax only that requirement; all cross-school FKs, approval evidence, VSC/DTR and gate protections remain unchanged.
ALTER TABLE staff_leave_requests ALTER COLUMN department_id DROP NOT NULL;
COMMENT ON COLUMN staff_leave_requests.department_id IS
 'Optional for school heads or staff without department assignment. Department review remains scoped when department_id is present.';
