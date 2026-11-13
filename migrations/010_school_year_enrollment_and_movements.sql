-- School-year records and year-specific enrollment. Existing students and attendance remain untouched.
CREATE TABLE IF NOT EXISTS school_years (
 school_year_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 school_year_label VARCHAR(20) NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
 status VARCHAR(12) NOT NULL DEFAULT 'SETUP' CHECK(status IN ('SETUP','ACTIVE','CLOSED')),
 created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,school_year_id), UNIQUE(school_id,school_year_label),
 FOREIGN KEY(school_id,created_by_user_id) REFERENCES school_users(school_id,user_id), CHECK(end_date>=start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_years_one_active_per_school ON school_years(school_id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS student_enrollments (
 enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL, student_id TEXT NOT NULL, school_year_id UUID NOT NULL,
 grade_level TEXT NOT NULL, section TEXT NOT NULL, enrollment_date DATE NOT NULL,
 enrollment_status VARCHAR(20) NOT NULL DEFAULT 'ENROLLED' CHECK(enrollment_status IN ('ENROLLED','TRANSFERRED_OUT','DROPPED_OUT','COMPLETED','WITHDRAWN')),
 status_effective_date DATE, remarks TEXT, created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,enrollment_id), UNIQUE(school_id,enrollment_id,student_id,school_year_id), UNIQUE(school_id,student_id,school_year_id),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,student_id),
 FOREIGN KEY(school_id,school_year_id) REFERENCES school_years(school_id,school_year_id),
 FOREIGN KEY(school_id,created_by_user_id) REFERENCES school_users(school_id,user_id),
 CHECK(length(trim(grade_level)) BETWEEN 1 AND 40), CHECK(length(trim(section)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS student_enrollments_roster_idx ON student_enrollments(school_id,school_year_id,grade_level,section,enrollment_status);
CREATE TABLE IF NOT EXISTS student_movements (
 movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL, student_id TEXT NOT NULL, school_year_id UUID NOT NULL,
 enrollment_id UUID NOT NULL, movement_type VARCHAR(30) NOT NULL CHECK(movement_type IN ('TRANSFER_IN','TRANSFER_OUT','DROPOUT','LATE_ENROLLMENT','RE_ENROLLMENT','SECTION_TRANSFER','GRADE_PROMOTION','OTHER')),
 effective_date DATE NOT NULL, from_grade_level TEXT, from_section TEXT, to_grade_level TEXT, to_section TEXT,
 destination_school_name TEXT, destination_school_id TEXT, official_code TEXT, reason TEXT, remarks TEXT, recorded_by_user_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,student_id),
 FOREIGN KEY(school_id,school_year_id) REFERENCES school_years(school_id,school_year_id),
 FOREIGN KEY(school_id,enrollment_id,student_id,school_year_id) REFERENCES student_enrollments(school_id,enrollment_id,student_id,school_year_id),
 FOREIGN KEY(school_id,recorded_by_user_id) REFERENCES school_users(school_id,user_id)
);
CREATE INDEX IF NOT EXISTS student_movements_history_idx ON student_movements(school_id,student_id,effective_date);
CREATE TABLE IF NOT EXISTS school_calendar (
 calendar_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL, school_year_id UUID NOT NULL,
 calendar_date DATE NOT NULL, day_type VARCHAR(25) NOT NULL CHECK(day_type IN ('CLASS_DAY','HOLIDAY','SUSPENSION','SPECIAL_NON_CLASS_DAY')),
 label TEXT, remarks TEXT, created_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,school_year_id,calendar_date),
 FOREIGN KEY(school_id,school_year_id) REFERENCES school_years(school_id,school_year_id),
 FOREIGN KEY(school_id,created_by_user_id) REFERENCES school_users(school_id,user_id)
);

-- Keep dates tied to the selected school year and make closed-year records read-only.
CREATE OR REPLACE FUNCTION validate_school_year_record_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE d1 DATE; d2 DATE;
BEGIN
 SELECT start_date,end_date INTO d1,d2 FROM school_years
  WHERE school_id=NEW.school_id AND school_year_id=NEW.school_year_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'School year not found for this school'; END IF;
 IF TG_TABLE_NAME='student_enrollments' THEN
  IF NEW.enrollment_date NOT BETWEEN d1 AND d2 THEN RAISE EXCEPTION 'Enrollment date must be within school year'; END IF;
  IF NEW.status_effective_date IS NOT NULL AND NEW.status_effective_date NOT BETWEEN d1 AND d2 THEN RAISE EXCEPTION 'Status date must be within school year'; END IF;
 ELSIF TG_TABLE_NAME='student_movements' AND NEW.effective_date NOT BETWEEN d1 AND d2 THEN
  RAISE EXCEPTION 'Movement date must be within school year';
 ELSIF TG_TABLE_NAME='school_calendar' AND NEW.calendar_date NOT BETWEEN d1 AND d2 THEN
  RAISE EXCEPTION 'Calendar date must be within school year';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_enrollments_date_guard BEFORE INSERT OR UPDATE ON student_enrollments
 FOR EACH ROW EXECUTE FUNCTION validate_school_year_record_dates();
CREATE TRIGGER student_movements_date_guard BEFORE INSERT OR UPDATE ON student_movements
 FOR EACH ROW EXECUTE FUNCTION validate_school_year_record_dates();
CREATE TRIGGER school_calendar_date_guard BEFORE INSERT OR UPDATE ON school_calendar
 FOR EACH ROW EXECUTE FUNCTION validate_school_year_record_dates();

CREATE OR REPLACE FUNCTION guard_closed_school_year_records()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE st VARCHAR(12);
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT status INTO st FROM school_years WHERE school_id=OLD.school_id AND school_year_id=OLD.school_year_id FOR SHARE;
  IF st='CLOSED' THEN RAISE EXCEPTION 'Records in a closed school year are read-only'; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT status INTO st FROM school_years WHERE school_id=NEW.school_id AND school_year_id=NEW.school_year_id FOR SHARE;
  IF st='CLOSED' THEN RAISE EXCEPTION 'Records in a closed school year are read-only'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_enrollments_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON student_enrollments
 FOR EACH ROW EXECUTE FUNCTION guard_closed_school_year_records();
CREATE TRIGGER student_movements_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON student_movements
 FOR EACH ROW EXECUTE FUNCTION guard_closed_school_year_records();
CREATE TRIGGER school_calendar_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON school_calendar
 FOR EACH ROW EXECUTE FUNCTION guard_closed_school_year_records();

CREATE OR REPLACE FUNCTION guard_school_year_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
  (OLD.status='SETUP' AND NEW.status='ACTIVE') OR
  (OLD.status='ACTIVE' AND NEW.status='CLOSED') OR
  (OLD.status='CLOSED' AND NEW.status='ACTIVE')) THEN
  RAISE EXCEPTION 'Invalid school-year status transition: % to %',OLD.status,NEW.status;
 END IF;
 NEW.updated_at=NOW();
 RETURN NEW;
END $$;
CREATE TRIGGER school_year_status_guard BEFORE UPDATE OF status ON school_years
 FOR EACH ROW EXECUTE FUNCTION guard_school_year_status_transition();
