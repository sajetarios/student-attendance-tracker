-- Preserve verified SF1 name components separately from official full_name.
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_last_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_first_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_middle_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS sf1_name_verified BOOLEAN NOT NULL DEFAULT FALSE;
