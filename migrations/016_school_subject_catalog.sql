-- Department-owned subject catalogue for consistent schedule creation.
-- Existing class periods are preserved and linked to canonical subject records.
CREATE TABLE IF NOT EXISTS school_subjects (
  subject_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  department_id UUID NOT NULL,
  subject_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_subjects_school_subject_uk UNIQUE (school_id, subject_id),
  CONSTRAINT school_subjects_name_nonblank CHECK (length(btrim(subject_name)) BETWEEN 1 AND 120),
  CONSTRAINT school_subjects_department_fk
    FOREIGN KEY (school_id, department_id)
    REFERENCES school_departments(school_id, department_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS school_subjects_department_name_ci_uk
  ON school_subjects (school_id, department_id, lower(btrim(subject_name)));

CREATE INDEX IF NOT EXISTS school_subjects_department_active_idx
  ON school_subjects (school_id, department_id, active, subject_name);

ALTER TABLE class_periods
  ADD COLUMN IF NOT EXISTS subject_id UUID;

-- Backfill a single canonical subject entry for every existing department/name pair.
INSERT INTO school_subjects (school_id, department_id, subject_name)
SELECT DISTINCT ON (p.school_id, p.department_id, lower(btrim(p.subject_name)))
       p.school_id, p.department_id, btrim(p.subject_name)
FROM class_periods p
WHERE p.subject_name IS NOT NULL AND btrim(p.subject_name) <> ''
ORDER BY p.school_id, p.department_id, lower(btrim(p.subject_name)), btrim(p.subject_name)
ON CONFLICT DO NOTHING;

UPDATE class_periods p
SET subject_id=s.subject_id
FROM school_subjects s
WHERE p.subject_id IS NULL
  AND p.school_id=s.school_id
  AND p.department_id=s.department_id
  AND p.subject_name IS NOT NULL
  AND lower(btrim(p.subject_name))=lower(btrim(s.subject_name));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='class_periods_subject_fk'
      AND conrelid='public.class_periods'::regclass
  ) THEN
    ALTER TABLE class_periods
      ADD CONSTRAINT class_periods_subject_fk
      FOREIGN KEY (school_id, subject_id)
      REFERENCES school_subjects(school_id, subject_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS class_periods_subject_idx
  ON class_periods (school_id, subject_id, active);

COMMENT ON TABLE school_subjects IS
  'Canonical subject options scoped to a school department. Class periods retain subject_name as a display snapshot for compatibility.';
COMMENT ON COLUMN class_periods.subject_id IS
  'Canonical school subject reference. Legacy records may remain NULL until edited.';
