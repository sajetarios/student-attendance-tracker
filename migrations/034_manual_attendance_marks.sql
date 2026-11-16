-- Manual paper-style classroom attendance, separate from QR/gate events.
CREATE TABLE IF NOT EXISTS manual_attendance_marks (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  period_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  school_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PRESENT','LATE','ABSENT','EXCUSED')),
  note TEXT NOT NULL DEFAULT '',
  marked_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, period_id, student_id, school_date),
  FOREIGN KEY (school_id, period_id) REFERENCES class_periods(school_id, period_id),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, student_id),
  FOREIGN KEY (school_id, marked_by) REFERENCES school_users(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS manual_attendance_marks_date_idx ON manual_attendance_marks(school_id,school_date,period_id);
