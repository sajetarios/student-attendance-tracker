-- Durable dated teacher notes, including changes and soft archive.
CREATE TABLE IF NOT EXISTS manual_attendance_notes (
 note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 period_id UUID NOT NULL,
 school_date DATE NOT NULL,
 author_id UUID NOT NULL,
 body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
 archived_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,period_id) REFERENCES class_periods(school_id,period_id),
 FOREIGN KEY(school_id,author_id) REFERENCES school_users(school_id,user_id)
);
CREATE INDEX IF NOT EXISTS manual_attendance_notes_school_period_date_idx
 ON manual_attendance_notes(school_id,period_id,school_date DESC,created_at DESC);
