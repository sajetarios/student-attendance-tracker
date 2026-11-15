-- Core multi-school schema used by the current Student Attendance Tracker.
-- Designed for a fresh TEST database. Do not use legacy single-school schema.sql as a substitute.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  school_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_code TEXT NOT NULL,
  school_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schools_code_nonblank CHECK (length(trim(school_code)) BETWEEN 1 AND 80),
  CONSTRAINT schools_name_nonblank CHECK (length(trim(school_name)) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS schools_school_code_ci_uk ON schools (lower(school_code));

CREATE TABLE IF NOT EXISTS platform_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_users_username_nonblank CHECK (length(trim(username)) BETWEEN 1 AND 80),
  CONSTRAINT platform_users_display_name_nonblank CHECK (length(trim(display_name)) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_users_username_ci_uk ON platform_users (lower(username));

CREATE TABLE IF NOT EXISTS school_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_users_role_check CHECK (role = ANY (ARRAY['SCHOOL_ADMIN'::TEXT, 'TEACHER'::TEXT])),
  CONSTRAINT school_users_user_name_nonblank CHECK (length(trim(username)) BETWEEN 1 AND 80),
  CONSTRAINT school_users_display_name_nonblank CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  CONSTRAINT school_users_school_user_uk UNIQUE (school_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_users_school_username_ci_uk
  ON school_users (school_id, lower(username));
CREATE INDEX IF NOT EXISTS school_users_school_role_idx ON school_users (school_id, role, active);

CREATE TABLE IF NOT EXISTS students (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  student_id TEXT PRIMARY KEY,
  lrn TEXT,
  full_name TEXT NOT NULL,
  grade_level TEXT NOT NULL DEFAULT 'Grade 7',
  section TEXT NOT NULL,
  parent_name TEXT,
  parent_mobile TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  qr_token UUID DEFAULT gen_random_uuid(),
  photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- student_id remains globally unique because the current roster API uses ON CONFLICT(student_id).
  -- This composite key also protects school-scoped foreign keys from cross-school references.
  CONSTRAINT students_school_student_uk UNIQUE (school_id, student_id),
  CONSTRAINT students_name_nonblank CHECK (length(trim(full_name)) BETWEEN 1 AND 200),
  CONSTRAINT students_grade_nonblank CHECK (length(trim(grade_level)) BETWEEN 1 AND 40),
  CONSTRAINT students_section_nonblank CHECK (length(trim(section)) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS students_school_lrn_uk
  ON students (school_id, lrn) WHERE lrn IS NOT NULL AND trim(lrn) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS students_school_qr_token_uk
  ON students (school_id, qr_token) WHERE qr_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS students_school_section_idx
  ON students (school_id, grade_level, section, active);

CREATE TABLE IF NOT EXISTS class_periods (
  period_id UUID NOT NULL DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  period_name TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  section TEXT,
  subject_name TEXT,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT class_periods_period_pk PRIMARY KEY (school_id, period_id),
  CONSTRAINT class_periods_school_period_uk UNIQUE (school_id, period_id),
  CONSTRAINT class_periods_time_valid CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS class_periods_school_active_time_idx
  ON class_periods (school_id, active, start_time);
CREATE INDEX IF NOT EXISTS class_periods_school_section_idx
  ON class_periods (school_id, grade_level, section, active);

CREATE TABLE IF NOT EXISTS attendance_devices (
  device_id TEXT PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  entrance_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_devices_school_device_uk UNIQUE (school_id, device_id)
);
CREATE INDEX IF NOT EXISTS attendance_devices_school_active_idx
  ON attendance_devices (school_id, active);

CREATE TABLE IF NOT EXISTS attendance_events (
  event_id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attendance_scope TEXT NOT NULL CHECK (attendance_scope IN ('SCHOOL','CLASS')),
  period_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('TIME_IN','TIME_OUT')),
  occurred_at_device TIMESTAMPTZ NOT NULL,
  received_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  school_date DATE NOT NULL,
  late BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'ACCEPTED',
  duplicate_of UUID REFERENCES attendance_events(event_id),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT attendance_events_student_fk
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, student_id) ON DELETE CASCADE,
  CONSTRAINT attendance_events_period_fk
    FOREIGN KEY (school_id, period_id) REFERENCES class_periods(school_id, period_id),
  CONSTRAINT attendance_events_scope_period_check CHECK (
    (attendance_scope='CLASS' AND period_id IS NOT NULL) OR
    (attendance_scope='SCHOOL' AND period_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS attendance_events_school_date_idx
  ON attendance_events (school_id, school_date, attendance_scope, period_id);
CREATE INDEX IF NOT EXISTS attendance_events_received_idx
  ON attendance_events (school_id, received_at_server DESC);
CREATE INDEX IF NOT EXISTS attendance_events_student_date_idx
  ON attendance_events (school_id, student_id, school_date);
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_punch_per_scope_day
  ON attendance_events (
    school_id, student_id, school_date, attendance_scope,
    COALESCE(period_id::TEXT, 'SCHOOL'), event_type
  ) WHERE sync_status='ACCEPTED';

CREATE TABLE IF NOT EXISTS sms_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE REFERENCES attendance_events(event_id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  provider_message_id TEXT,
  provider_status TEXT,
  provider_response JSONB,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sms_outbox_pending_idx ON sms_outbox (status, created_at);

CREATE TABLE IF NOT EXISTS school_settings (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, setting_key)
);

COMMENT ON TABLE schools IS 'Tenant registry for the multi-school Student Attendance Tracker.';
COMMENT ON TABLE school_users IS 'School-scoped login accounts. Teacher capabilities are stored separately in teacher_designations.';
COMMENT ON TABLE attendance_events IS 'Immutable, school-scoped learner attendance punches. Missing punches do not imply an absence.';
