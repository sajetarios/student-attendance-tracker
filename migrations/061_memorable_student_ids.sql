-- 061: Short, memorable internal Student IDs such as 26-00089.
-- student_id remains the global primary key; counters must be globally unique
-- across all schools. Existing year-grade IDs, STU IDs, enrollment, QR tokens,
-- attendance, and student account usernames are never rewritten.
-- A two-digit prefix represents the first registration year in 2000-2099.
CREATE TABLE IF NOT EXISTS attendigo_student_short_id_counters (
  registration_year INTEGER PRIMARY KEY CHECK (registration_year BETWEEN 2000 AND 2099),
  last_number INTEGER NOT NULL CHECK (last_number BETWEEN 1 AND 99999)
);

-- Seed from all issued short-form IDs, including manually entered identifiers.
-- No existing student is modified.
INSERT INTO attendigo_student_short_id_counters (registration_year, last_number)
SELECT 2000 + substring(student_id FROM 1 FOR 2)::int AS registration_year,
       MAX(substring(student_id FROM 4)::int) AS last_number
  FROM students
 WHERE student_id ~ '^[0-9]{2}-[0-9]{5}$'
   AND substring(student_id FROM 4)::int BETWEEN 1 AND 99999
 GROUP BY 1
ON CONFLICT (registration_year) DO UPDATE
  SET last_number = GREATEST(attendigo_student_short_id_counters.last_number, EXCLUDED.last_number);
