-- Additive SHS integration. Never rewrites attendance, staff DTR, or prior JHS learners.
-- Schools with existing Grade 11/12 records default to integrated; others to JHS only.
CREATE TABLE IF NOT EXISTS school_academic_levels (
  school_id uuid PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
  level_mode text NOT NULL DEFAULT 'JHS_ONLY'
    CHECK (level_mode IN ('JHS_ONLY','SHS_ONLY','INTEGRATED')),
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO school_academic_levels(school_id,level_mode)
SELECT sc.school_id,
 CASE WHEN EXISTS(SELECT 1 FROM students st WHERE st.school_id=sc.school_id
      AND st.grade_level IN ('Grade 11','Grade 12'))
        OR EXISTS(SELECT 1 FROM class_periods cp WHERE cp.school_id=sc.school_id
      AND cp.grade_level IN ('Grade 11','Grade 12'))
        OR EXISTS(SELECT 1 FROM school_sections ss WHERE ss.school_id=sc.school_id
      AND ss.grade_level IN ('Grade 11','Grade 12'))
        OR EXISTS(SELECT 1 FROM student_enrollments en WHERE en.school_id=sc.school_id
      AND en.grade_level IN ('Grade 11','Grade 12'))
        OR EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=sc.school_id
      AND ca.grade_level IN ('Grade 11','Grade 12'))
    THEN 'INTEGRATED' ELSE 'JHS_ONLY' END
FROM schools sc
ON CONFLICT(school_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS shs_year_curricula (
  school_id uuid NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  school_year_id uuid NOT NULL REFERENCES school_years(school_year_id) ON DELETE CASCADE,
  grade_level text NOT NULL CHECK (grade_level IN ('Grade 11','Grade 12')),
  curriculum_version text NOT NULL CHECK (curriculum_version IN ('STRENGTHENED','LEGACY')),
  grade12_pilot_confirmed boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, school_year_id, grade_level),
  CONSTRAINT shs_pilot_only_strengthened_grade12 CHECK (
    NOT grade12_pilot_confirmed OR (grade_level='Grade 12' AND curriculum_version='STRENGTHENED')
  )
);
CREATE INDEX IF NOT EXISTS shs_year_curricula_year_idx
 ON shs_year_curricula(school_year_id,school_id);

CREATE TABLE IF NOT EXISTS shs_learner_paths (
  school_id uuid NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  enrollment_id uuid PRIMARY KEY REFERENCES student_enrollments(enrollment_id) ON DELETE CASCADE,
  track_code text NOT NULL CHECK (track_code IN ('ACADEMIC','TECHPRO','TVL','SPORTS','ARTS_AND_DESIGN')),
  strand_code text,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT shs_strand_length CHECK (strand_code IS NULL OR length(strand_code) BETWEEN 1 AND 80)
);
CREATE INDEX IF NOT EXISTS shs_learner_paths_school_idx
 ON shs_learner_paths(school_id,enrollment_id);

-- Defense in depth: all legacy registration/import, section, adviser and scheduling
-- paths obey the school's active grade levels, not only dropdown visibility.
CREATE OR REPLACE FUNCTION school_offers_grade(p_school uuid,p_grade text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_mode text;
BEGIN
 SELECT level_mode INTO v_mode FROM school_academic_levels WHERE school_id=p_school;
 v_mode:=COALESCE(v_mode,'JHS_ONLY');
 IF p_grade IN ('Grade 11','Grade 12') AND v_mode='JHS_ONLY' THEN RETURN false; END IF;
 IF p_grade IN ('Grade 7','Grade 8','Grade 9','Grade 10') AND v_mode='SHS_ONLY' THEN RETURN false; END IF;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_school_grade_offering()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.grade_level IS NOT DISTINCT FROM OLD.grade_level THEN
   RETURN NEW;
 END IF;
 IF NOT school_offers_grade(NEW.school_id,NEW.grade_level) THEN
  RAISE EXCEPTION 'Grade level % is not enabled for this school', NEW.grade_level
    USING ERRCODE='23514',CONSTRAINT='school_grade_not_offered';
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shs_school_grade_students ON students;
CREATE TRIGGER shs_school_grade_students
 BEFORE INSERT OR UPDATE OF grade_level ON students
 FOR EACH ROW EXECUTE FUNCTION enforce_school_grade_offering();

DROP TRIGGER IF EXISTS shs_school_grade_enrollments ON student_enrollments;
CREATE TRIGGER shs_school_grade_enrollments
 BEFORE INSERT OR UPDATE OF grade_level ON student_enrollments
 FOR EACH ROW EXECUTE FUNCTION enforce_school_grade_offering();

DROP TRIGGER IF EXISTS shs_school_grade_periods ON class_periods;
CREATE TRIGGER shs_school_grade_periods
 BEFORE INSERT OR UPDATE OF grade_level ON class_periods
 FOR EACH ROW EXECUTE FUNCTION enforce_school_grade_offering();

DROP TRIGGER IF EXISTS shs_school_grade_sections ON school_sections;
CREATE TRIGGER shs_school_grade_sections
 BEFORE INSERT OR UPDATE OF grade_level ON school_sections
 FOR EACH ROW EXECUTE FUNCTION enforce_school_grade_offering();

DROP TRIGGER IF EXISTS shs_school_grade_advisers ON class_adviser_assignments;
CREATE TRIGGER shs_school_grade_advisers
 BEFORE INSERT OR UPDATE OF grade_level ON class_adviser_assignments
 FOR EACH ROW EXECUTE FUNCTION enforce_school_grade_offering();
