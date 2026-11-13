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
