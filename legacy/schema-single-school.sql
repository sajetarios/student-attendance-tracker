CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY,
  lrn TEXT UNIQUE,
  full_name TEXT NOT NULL,
  grade_level TEXT NOT NULL DEFAULT 'Grade 7',
  section TEXT NOT NULL,
  parent_name TEXT,
  parent_mobile TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_periods (
  period_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT,
  subject_name TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS attendance_events (
  event_id UUID PRIMARY KEY,
  device_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  attendance_scope TEXT NOT NULL CHECK (attendance_scope IN ('SCHOOL','CLASS')),
  period_id UUID REFERENCES class_periods(period_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('TIME_IN','TIME_OUT')),
  occurred_at_device TIMESTAMPTZ NOT NULL,
  received_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  school_date DATE NOT NULL,
  late BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'ACCEPTED',
  duplicate_of UUID REFERENCES attendance_events(event_id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((attendance_scope = 'CLASS' AND period_id IS NOT NULL) OR
         (attendance_scope = 'SCHOOL' AND period_id IS NULL))
);

-- One accepted punch of each type per student per scope/period/day.
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_punch_per_scope_day
ON attendance_events(
  student_id, school_date, attendance_scope,
  COALESCE(period_id::text, 'SCHOOL'), event_type
) WHERE sync_status = 'ACCEPTED';

CREATE INDEX IF NOT EXISTS attendance_by_day_idx
ON attendance_events(school_date, attendance_scope, period_id);

CREATE TABLE IF NOT EXISTS attendance_devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  entrance_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE REFERENCES attendance_events(event_id),
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sms_outbox_pending_idx
ON sms_outbox(status, created_at);

-- Example roster import:
-- INSERT INTO students(student_id, lrn, full_name, grade_level, section, parent_name, parent_mobile)
-- VALUES ('JHS-0001', '123456789012', 'Juan Dela Cruz', 'Grade 8', 'Section A', 'Maria Dela Cruz', '09XXXXXXXXX');

-- Create class periods in the admin screen/API. Example only:
-- INSERT INTO class_periods(period_name, grade_level, section, subject_name, start_time, end_time, grace_minutes)
-- VALUES ('Period 1', 'Grade 8', 'Section A', 'Mathematics', '07:30', '08:30', 5);


-- School-level arrival cutoff. Configure this to the school's actual first bell.
CREATE TABLE IF NOT EXISTS school_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


ALTER TABLE sms_outbox
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_response JSONB;

CREATE INDEX IF NOT EXISTS attendance_events_received_idx
ON attendance_events(received_at_server DESC);

CREATE INDEX IF NOT EXISTS attendance_events_student_date_idx
ON attendance_events(student_id, school_date);
