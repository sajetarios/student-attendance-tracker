-- Schedule-scoped student QR check-ins. Existing gate events remain unchanged.
CREATE TABLE IF NOT EXISTS class_qr_sessions (
 session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL, period_id UUID NOT NULL, school_date DATE NOT NULL,
 teacher_user_id UUID NOT NULL, grade_level TEXT NOT NULL, section TEXT NOT NULL,
 subject_name TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL, closes_at TIMESTAMPTZ NOT NULL,
 secret TEXT NOT NULL, closed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,period_id,school_date),
 FOREIGN KEY(school_id,period_id) REFERENCES class_periods(school_id,period_id),
 FOREIGN KEY(school_id,teacher_user_id) REFERENCES school_users(school_id,user_id),
 CHECK(ends_at>starts_at AND closes_at=ends_at-INTERVAL '5 minutes')
);
CREATE TABLE IF NOT EXISTS class_qr_checkins (
 checkin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id UUID NOT NULL REFERENCES class_qr_sessions(session_id),
 school_id UUID NOT NULL, student_id TEXT NOT NULL,
 checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 attendance_status TEXT NOT NULL CHECK(attendance_status IN ('PRESENT','LATE')),
 method TEXT NOT NULL DEFAULT 'QR' CHECK(method IN ('QR','MANUAL')),
 recorded_by_user_id UUID, reason TEXT,
 UNIQUE(session_id,student_id),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,student_id)
);
CREATE INDEX IF NOT EXISTS class_qr_checkins_school_idx ON class_qr_checkins(school_id,session_id);
