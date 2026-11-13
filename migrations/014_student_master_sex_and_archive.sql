-- Migration 014: student master sex and archive metadata.
-- Existing learners remain editable; legacy sex values are normalized before validation.
ALTER TABLE students ADD COLUMN IF NOT EXISTS sex VARCHAR(10);

UPDATE students
SET sex = CASE
  WHEN UPPER(TRIM(COALESCE(sex, ''))) IN ('M','MALE') THEN 'MALE'
  WHEN UPPER(TRIM(COALESCE(sex, ''))) IN ('F','FEMALE') THEN 'FEMALE'
  ELSE NULL
END
WHERE sex IS NOT NULL OR EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='students' AND column_name='sex'
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_sex_valid;
ALTER TABLE students ADD CONSTRAINT students_sex_valid
  CHECK (sex IS NULL OR sex IN ('MALE','FEMALE'));
CREATE INDEX IF NOT EXISTS students_school_archive_idx
  ON students(school_id, archived_at, active);
