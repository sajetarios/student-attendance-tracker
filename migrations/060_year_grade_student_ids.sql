-- 060: Immutable registration-year/grade internal Student IDs.
-- student_id is a globally unique primary key: counters must be global even
-- though school-scoped permissions and all existing records remain unchanged.
-- Three digits allow a maximum of 999 new identifiers for any year/grade
-- across Attendigo; allocation fails explicitly when the series is exhausted.
CREATE TABLE IF NOT EXISTS attendigo_student_id_counters (
  registration_year INTEGER NOT NULL CHECK (registration_year BETWEEN 2000 AND 9999),
  registration_grade INTEGER NOT NULL CHECK (registration_grade BETWEEN 1 AND 12),
  last_number INTEGER NOT NULL CHECK (last_number BETWEEN 1 AND 999),
  PRIMARY KEY (registration_year, registration_grade)
);

-- Respect already-issued IDs, including imported and manually entered IDs.
INSERT INTO attendigo_student_id_counters(registration_year, registration_grade, last_number)
SELECT split_part(student_id, '-', 1)::int AS registration_year,
       substring(split_part(student_id, '-', 2) FROM 2)::int AS registration_grade,
       MAX(split_part(student_id, '-', 3)::int) AS last_number
  FROM students
 WHERE student_id ~ '^[0-9]{4}-G(1[0-2]|[1-9])-[0-9]{3}$'
   AND split_part(student_id, '-', 1)::int BETWEEN 2000 AND 9999
 GROUP BY 1, 2
ON CONFLICT(registration_year, registration_grade)
DO UPDATE SET last_number = GREATEST(
    attendigo_student_id_counters.last_number, EXCLUDED.last_number
);
