-- School-configurable special programs; enforce one active primary program per learner/year.
CREATE TABLE IF NOT EXISTS special_program_types (
 program_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 program_code VARCHAR(30) NOT NULL, program_name VARCHAR(120) NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
 created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,program_type_id), UNIQUE(school_id,program_code),
 FOREIGN KEY(school_id,created_by_user_id) REFERENCES school_users(school_id,user_id)
);
CREATE TABLE IF NOT EXISTS student_special_programs (
 student_program_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL, student_id TEXT NOT NULL,
 school_year_id UUID NOT NULL, enrollment_id UUID NOT NULL, program_type_id UUID NOT NULL, is_primary BOOLEAN NOT NULL DEFAULT TRUE,
 start_date DATE NOT NULL, end_date DATE, status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','WITHDRAWN')),
 notes TEXT, assigned_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,enrollment_id,student_id,school_year_id) REFERENCES student_enrollments(school_id,enrollment_id,student_id,school_year_id),
 FOREIGN KEY(school_id,program_type_id) REFERENCES special_program_types(school_id,program_type_id),
 FOREIGN KEY(school_id,assigned_by_user_id) REFERENCES school_users(school_id,user_id),
 CHECK(end_date IS NULL OR end_date>=start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_special_programs_one_primary_per_year
 ON student_special_programs(school_id,student_id,school_year_id) WHERE is_primary AND status='ACTIVE';
CREATE INDEX IF NOT EXISTS student_special_programs_roster_idx ON student_special_programs(school_id,school_year_id,status);

-- Validate special-program dates and make closed school-year records immutable.
CREATE OR REPLACE FUNCTION protect_student_special_program_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE y_status VARCHAR(12); y_start DATE; y_end DATE;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT status INTO y_status FROM school_years WHERE school_id=OLD.school_id AND school_year_id=OLD.school_year_id FOR SHARE;
  IF y_status='CLOSED' THEN RAISE EXCEPTION 'Records in a closed school year are read-only'; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT status,start_date,end_date INTO y_status,y_start,y_end FROM school_years
   WHERE school_id=NEW.school_id AND school_year_id=NEW.school_year_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'School year not found'; END IF;
  IF y_status='CLOSED' THEN RAISE EXCEPTION 'Records in a closed school year are read-only'; END IF;
  IF NEW.start_date NOT BETWEEN y_start AND y_end OR
     (NEW.end_date IS NOT NULL AND NEW.end_date NOT BETWEEN y_start AND y_end) THEN
    RAISE EXCEPTION 'Special-program dates must be within the school year';
  END IF;
  NEW.updated_at=NOW();
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_special_programs_year_guard
 BEFORE INSERT OR UPDATE OR DELETE ON student_special_programs
 FOR EACH ROW EXECUTE FUNCTION protect_student_special_program_year();
