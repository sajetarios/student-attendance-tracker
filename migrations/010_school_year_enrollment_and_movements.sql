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
