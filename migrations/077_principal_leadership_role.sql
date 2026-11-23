-- 077: A distinct, read-only Principal leadership role. Additive, no staff role conversions.
-- Explicit SQL role constraint keeps API and database aligned without granting
-- School Administrator powers to the Principal.
ALTER TABLE school_users DROP CONSTRAINT IF EXISTS school_users_role_check;
ALTER TABLE school_users ADD CONSTRAINT school_users_role_check CHECK(
  role=ANY(ARRAY[
    'SCHOOL_ADMIN'::TEXT,'PRINCIPAL'::TEXT,'DEPARTMENT_HEAD'::TEXT,
    'TEACHER'::TEXT,'GATE_KEEPER'::TEXT,'PARENT'::TEXT
  ])
);
COMMENT ON CONSTRAINT school_users_role_check ON school_users IS
 'Principal is an independent school-scoped read-only leadership role. No administrator permissions implied.';
