-- Student master record demographic field used by official SF2 generation.
-- Existing records remain nullable so schools can progressively complete missing data.
ALTER TABLE students ADD COLUMN IF NOT EXISTS sex VARCHAR(10);
UPDATE students SET sex=UPPER(TRIM(sex)) WHERE sex IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='students_sex_valid_ck') THEN
    ALTER TABLE students ADD CONSTRAINT students_sex_valid_ck
      CHECK (sex IS NULL OR sex IN ('MALE','FEMALE'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS students_school_sex_idx ON students(school_id, sex) WHERE active=TRUE;
