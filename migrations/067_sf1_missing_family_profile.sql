-- Preserve separately declared family facts from official DepEd LIS SF1.
-- No changes to students' current parent/guardian designation or attendance.
ALTER TABLE students ADD COLUMN IF NOT EXISTS father_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS mother_maiden_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_guardian_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_address TEXT;
