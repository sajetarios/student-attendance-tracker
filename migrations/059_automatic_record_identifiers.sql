-- 059: Auto-generated internal Student IDs (distinct from official DepEd LRNs).
-- No existing identifier, login, QR token, attendance record or foreign key is changed.
-- A single database sequence is used because students.student_id is globally unique.
CREATE SEQUENCE IF NOT EXISTS attendigo_student_id_seq AS BIGINT START WITH 1;

-- Start after previously assigned STU-numeric IDs if any exist. Other manual IDs are untouched.
WITH previous AS (
  SELECT COALESCE(MAX(substring(student_id FROM '^STU-([0-9]+)
)::bigint), 0) AS highest
    FROM students
   WHERE student_id ~ '^STU-[0-9]{1,16}

)
SELECT setval('attendigo_student_id_seq', GREATEST(highest, 1), highest > 0)
  FROM previous;
