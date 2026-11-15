-- Migration 010: School-year enrollment, learner movements, and school calendar.
-- Existing student records and attendance history are intentionally preserved.
-- Existing learners are NOT automatically enrolled into a school year.

-- =========================================================
-- 1. SCHOOL YEARS
-- =========================================================

CREATE TABLE IF NOT EXISTS school_years (
  school_year_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  school_year_label VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'SETUP'
    CHECK (status IN ('SETUP', 'ACTIVE', 'CLOSED')),
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT school_years_school_year_uk
    UNIQUE (school_id, school_year_id),

  CONSTRAINT school_years_label_uk
    UNIQUE (school_id, school_year_label),

  CONSTRAINT school_years_dates_valid
    CHECK (end_date >= start_date),

  CONSTRAINT school_years_label_nonblank
    CHECK (length(trim(school_year_label)) BETWEEN 1 AND 20),

  CONSTRAINT school_years_creator_fk
    FOREIGN KEY (school_id, created_by_user_id)
    REFERENCES school_users(school_id, user_id)
);

-- Only one active school year per school.
CREATE UNIQUE INDEX IF NOT EXISTS school_years_one_active_per_school_uk
  ON school_years(school_id)
  WHERE status = 'ACTIVE';

-- =========================================================
-- 2. STUDENT ENROLLMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS student_enrollments (
  enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  school_year_id UUID NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT NOT NULL,
  enrollment_date DATE NOT NULL,
  enrollment_status VARCHAR(20) NOT NULL DEFAULT 'ENROLLED'
    CHECK (
      enrollment_status IN (
        'ENROLLED',
        'TRANSFERRED_OUT',
        'DROPPED_OUT',
        'COMPLETED',
        'WITHDRAWN'
      )
    ),
  status_effective_date DATE,
  remarks TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT student_enrollments_school_id_uk
    UNIQUE (school_id, enrollment_id),

  CONSTRAINT student_enrollments_movement_reference_uk
    UNIQUE (school_id, enrollment_id, student_id, school_year_id),

  CONSTRAINT student_enrollments_one_per_year_uk
    UNIQUE (school_id, student_id, school_year_id),

  CONSTRAINT student_enrollments_student_fk
    FOREIGN KEY (school_id, student_id)
    REFERENCES students(school_id, student_id),

  CONSTRAINT student_enrollments_school_year_fk
    FOREIGN KEY (school_id, school_year_id)
    REFERENCES school_years(school_id, school_year_id),

  CONSTRAINT student_enrollments_creator_fk
    FOREIGN KEY (school_id, created_by_user_id)
    REFERENCES school_users(school_id, user_id),

  CONSTRAINT student_enrollments_grade_nonblank
    CHECK (length(trim(grade_level)) BETWEEN 1 AND 40),

  CONSTRAINT student_enrollments_section_nonblank
    CHECK (length(trim(section)) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS student_enrollments_roster_idx
  ON student_enrollments(school_id, school_year_id, grade_level, section, enrollment_status);

CREATE INDEX IF NOT EXISTS student_enrollments_student_history_idx
  ON student_enrollments(school_id, student_id, enrollment_date);

-- =========================================================
-- 3. LEARNER MOVEMENT HISTORY
-- =========================================================

CREATE TABLE IF NOT EXISTS student_movements (
  movement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  school_year_id UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  movement_type VARCHAR(30) NOT NULL
    CHECK (
      movement_type IN (
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'DROPOUT',
        'LATE_ENROLLMENT',
        'RE_ENROLLMENT',
        'SECTION_TRANSFER',
        'GRADE_PROMOTION',
        'OTHER'
      )
    ),
  effective_date DATE NOT NULL,

  from_grade_level TEXT,
  from_section TEXT,
  to_grade_level TEXT,
  to_section TEXT,

  destination_school_name TEXT,
  destination_school_id TEXT,

  official_code TEXT,
  reason TEXT,
  remarks TEXT,

  recorded_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT student_movements_student_fk
    FOREIGN KEY (school_id, student_id)
    REFERENCES students(school_id, student_id),

  CONSTRAINT student_movements_school_year_fk
    FOREIGN KEY (school_id, school_year_id)
    REFERENCES school_years(school_id, school_year_id),

  CONSTRAINT student_movements_enrollment_fk
    FOREIGN KEY (school_id, enrollment_id, student_id, school_year_id)
    REFERENCES student_enrollments(
      school_id, enrollment_id, student_id, school_year_id
    ),

  CONSTRAINT student_movements_recorder_fk
    FOREIGN KEY (school_id, recorded_by_user_id)
    REFERENCES school_users(school_id, user_id)
);

CREATE INDEX IF NOT EXISTS student_movements_student_history_idx
  ON student_movements(school_id, student_id, effective_date);

CREATE INDEX IF NOT EXISTS student_movements_monthly_report_idx
  ON student_movements(school_id, school_year_id, movement_type, effective_date);

-- =========================================================
-- 4. SCHOOL CALENDAR
-- =========================================================

CREATE TABLE IF NOT EXISTS school_calendar (
  calendar_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  school_year_id UUID NOT NULL,
  calendar_date DATE NOT NULL,
  day_type VARCHAR(25) NOT NULL
    CHECK (
      day_type IN (
        'CLASS_DAY',
        'HOLIDAY',
        'SUSPENSION',
        'SPECIAL_NON_CLASS_DAY'
      )
    ),
  label TEXT,
  remarks TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT school_calendar_school_date_uk
    UNIQUE (school_id, school_year_id, calendar_date),

  CONSTRAINT school_calendar_school_year_fk
    FOREIGN KEY (school_id, school_year_id)
    REFERENCES school_years(school_id, school_year_id),

  CONSTRAINT school_calendar_creator_fk
    FOREIGN KEY (school_id, created_by_user_id)
    REFERENCES school_users(school_id, user_id)
);

CREATE INDEX IF NOT EXISTS school_calendar_date_type_idx
  ON school_calendar(school_id, school_year_id, day_type, calendar_date);

-- =========================================================
-- 5. SCHOOL-YEAR DATE VALIDATION
-- =========================================================

-- Validate dates whenever an enrollment, movement, or calendar
-- record is inserted or updated.
CREATE OR REPLACE FUNCTION validate_school_year_record_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  year_start DATE;
  year_end DATE;
BEGIN
  SELECT start_date, end_date
    INTO year_start, year_end
  FROM school_years
  WHERE school_id = NEW.school_id
    AND school_year_id = NEW.school_year_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'School year does not exist for this school';
  END IF;

  IF TG_TABLE_NAME = 'student_enrollments' THEN
    IF NEW.enrollment_date NOT BETWEEN year_start AND year_end THEN
      RAISE EXCEPTION 'Enrollment date must be within the school year';
    END IF;

    IF NEW.status_effective_date IS NOT NULL
       AND NEW.status_effective_date NOT BETWEEN year_start AND year_end THEN
      RAISE EXCEPTION 'Enrollment status effective date must be within the school year';
    END IF;

  ELSIF TG_TABLE_NAME = 'student_movements' THEN
    IF NEW.effective_date NOT BETWEEN year_start AND year_end THEN
      RAISE EXCEPTION 'Movement effective date must be within the school year';
    END IF;

  ELSIF TG_TABLE_NAME = 'school_calendar' THEN
    IF NEW.calendar_date NOT BETWEEN year_start AND year_end THEN
      RAISE EXCEPTION 'Calendar date must be within the school year';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER student_enrollments_validate_dates
BEFORE INSERT OR UPDATE ON student_enrollments
FOR EACH ROW
EXECUTE FUNCTION validate_school_year_record_dates();

CREATE TRIGGER student_movements_validate_dates
BEFORE INSERT OR UPDATE ON student_movements
FOR EACH ROW
EXECUTE FUNCTION validate_school_year_record_dates();

CREATE TRIGGER school_calendar_validate_dates
BEFORE INSERT OR UPDATE ON school_calendar
FOR EACH ROW
EXECUTE FUNCTION validate_school_year_record_dates();


-- Prevent changing school-year boundaries when existing records
-- would fall outside the proposed dates.
CREATE OR REPLACE FUNCTION protect_school_year_existing_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM student_enrollments
    WHERE school_id = OLD.school_id
      AND school_year_id = OLD.school_year_id
      AND (
        enrollment_date NOT BETWEEN NEW.start_date AND NEW.end_date
        OR (
          status_effective_date IS NOT NULL
          AND status_effective_date NOT BETWEEN NEW.start_date AND NEW.end_date
        )
      )
  ) THEN
    RAISE EXCEPTION 'New school-year dates would invalidate existing enrollments';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM student_movements
    WHERE school_id = OLD.school_id
      AND school_year_id = OLD.school_year_id
      AND effective_date NOT BETWEEN NEW.start_date AND NEW.end_date
  ) THEN
    RAISE EXCEPTION 'New school-year dates would invalidate existing movements';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM school_calendar
    WHERE school_id = OLD.school_id
      AND school_year_id = OLD.school_year_id
      AND calendar_date NOT BETWEEN NEW.start_date AND NEW.end_date
  ) THEN
    RAISE EXCEPTION 'New school-year dates would invalidate existing calendar entries';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER school_years_protect_existing_dates
BEFORE UPDATE OF start_date, end_date ON school_years
FOR EACH ROW
EXECUTE FUNCTION protect_school_year_existing_dates();

-- =========================================================
-- 6. CLOSED SCHOOL YEAR RECORD PROTECTION
-- =========================================================

-- Prevent inserting, updating, or deleting records belonging
-- to a closed school year.
CREATE OR REPLACE FUNCTION prevent_closed_school_year_records()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  year_status VARCHAR(12);
BEGIN
  -- Protect the original school year on UPDATE and DELETE.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status
      INTO year_status
    FROM school_years
    WHERE school_id = OLD.school_id
      AND school_year_id = OLD.school_year_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Original school year does not exist';
    END IF;

    IF year_status = 'CLOSED' THEN
      RAISE EXCEPTION
        'Records in a closed school year are read-only';
    END IF;
  END IF;

  -- Protect the destination school year on INSERT and UPDATE.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status
      INTO year_status
    FROM school_years
    WHERE school_id = NEW.school_id
      AND school_year_id = NEW.school_year_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destination school year does not exist';
    END IF;

    IF year_status = 'CLOSED' THEN
      RAISE EXCEPTION
        'Records in a closed school year are read-only';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER student_enrollments_closed_year_protection
BEFORE INSERT OR UPDATE OR DELETE ON student_enrollments
FOR EACH ROW
EXECUTE FUNCTION prevent_closed_school_year_records();

CREATE TRIGGER student_movements_closed_year_protection
BEFORE INSERT OR UPDATE OR DELETE ON student_movements
FOR EACH ROW
EXECUTE FUNCTION prevent_closed_school_year_records();

CREATE TRIGGER school_calendar_closed_year_protection
BEFORE INSERT OR UPDATE OR DELETE ON school_calendar
FOR EACH ROW
EXECUTE FUNCTION prevent_closed_school_year_records();

-- =========================================================
-- 7. SCHOOL-YEAR STATUS TRANSITION VALIDATION
-- =========================================================

-- Restrict status changes to the approved lifecycle.
-- School Administrator authorization is enforced by the API.
CREATE OR REPLACE FUNCTION validate_school_year_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'SETUP' AND NEW.status = 'ACTIVE')
      OR
      (OLD.status = 'ACTIVE' AND NEW.status = 'CLOSED')
      OR
      (OLD.status = 'CLOSED' AND NEW.status = 'ACTIVE')
    ) THEN
      RAISE EXCEPTION
        'Invalid school-year status transition: % to %',
        OLD.status,
        NEW.status;
    END IF;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER school_years_validate_status_transition
BEFORE UPDATE OF status ON school_years
FOR EACH ROW
EXECUTE FUNCTION validate_school_year_status_transition();
