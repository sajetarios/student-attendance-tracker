-- Additive preparation for passwordless student QR attendance.
-- No existing student password, attendance event, or session is changed.
CREATE TABLE IF NOT EXISTS student_attendance_pins (
 school_id UUID NOT NULL,
 student_id TEXT NOT NULL,
 pin_hash TEXT NOT NULL,
 failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
 locked_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (school_id,student_id),
 FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,student_id) ON DELETE CASCADE,
 CHECK (length(pin_hash) BETWEEN 40 AND 256)
);
COMMENT ON TABLE student_attendance_pins IS
 'Separate salted PIN hashes for passwordless class QR attendance; never use as student portal credentials.';
