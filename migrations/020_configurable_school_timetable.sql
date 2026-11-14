-- Configurable school calendar and timetable foundations.
-- Additive only: existing class_periods and attendance history remain untouched.

CREATE TABLE IF NOT EXISTS school_operating_days (
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_operating_day BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id UUID,
  PRIMARY KEY (school_id, weekday)
);

-- Seed a conventional Monday-Friday baseline for schools with no configuration.
INSERT INTO school_operating_days (school_id, weekday, is_operating_day)
SELECT s.school_id, d.weekday, d.weekday BETWEEN 1 AND 5
FROM schools s
CROSS JOIN generate_series(0, 6) AS d(weekday)
ON CONFLICT (school_id, weekday) DO NOTHING;

CREATE TABLE IF NOT EXISTS timetable_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  template_name TEXT NOT NULL CHECK (length(btrim(template_name)) BETWEEN 1 AND 100),
  shift_code TEXT NOT NULL DEFAULT 'REGULAR'
    CHECK (shift_code IN ('REGULAR','MORNING','AFTERNOON','EVENING','WEEKEND','CUSTOM')),
  effective_from DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  UNIQUE (school_id, template_id)
);

CREATE INDEX IF NOT EXISTS timetable_templates_school_active_idx
  ON timetable_templates(school_id, active, template_name);

CREATE TABLE IF NOT EXISTS timetable_template_periods (
  template_period_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  template_id UUID NOT NULL,
  period_order SMALLINT NOT NULL CHECK (period_order BETWEEN 1 AND 100),
  period_label TEXT NOT NULL CHECK (length(btrim(period_label)) BETWEEN 1 AND 80),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  block_type TEXT NOT NULL DEFAULT 'CLASS'
    CHECK (block_type IN ('CLASS','BREAK','LUNCH','HOMEROOM','ADVISORY','OTHER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (school_id, template_period_id),
  UNIQUE (template_id, period_order),
  FOREIGN KEY (school_id, template_id)
    REFERENCES timetable_templates(school_id, template_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS school_calendar_exceptions (
  exception_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  calendar_date DATE NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 140),
  exception_type TEXT NOT NULL
    CHECK (exception_type IN ('CLOSED','OPEN','SPECIAL_CLASS','SHORTENED_DAY')),
  notes TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, calendar_date)
);

CREATE INDEX IF NOT EXISTS school_calendar_exceptions_date_idx
  ON school_calendar_exceptions(school_id, calendar_date);

-- Schedule versions carry effective dates so future timetable changes need not
-- rewrite attendance records or silently redefine prior school days.
ALTER TABLE class_periods
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to DATE,
  ADD COLUMN IF NOT EXISTS timetable_template_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='class_periods_timetable_template_fk'
      AND conrelid='public.class_periods'::regclass
  ) THEN
    ALTER TABLE class_periods
      ADD CONSTRAINT class_periods_timetable_template_fk
      FOREIGN KEY (school_id, timetable_template_id)
      REFERENCES timetable_templates(school_id, template_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE class_periods
  DROP CONSTRAINT IF EXISTS class_periods_effective_dates_check;
ALTER TABLE class_periods
  ADD CONSTRAINT class_periods_effective_dates_check
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);

CREATE TABLE IF NOT EXISTS class_period_days (
  school_id UUID NOT NULL,
  period_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, period_id, weekday),
  FOREIGN KEY (school_id, period_id)
    REFERENCES class_periods(school_id, period_id) ON DELETE CASCADE
);

-- Existing schedules retain their current behavior by defaulting to configured
-- operating days. If none are configured, use Monday-Friday for legacy rows.
INSERT INTO class_period_days(school_id, period_id, weekday)
SELECT p.school_id, p.period_id, d.weekday
FROM class_periods p
CROSS JOIN LATERAL (
  SELECT weekday FROM school_operating_days sod
  WHERE sod.school_id=p.school_id AND sod.is_operating_day=TRUE
  UNION ALL
  SELECT weekday FROM generate_series(1,5) AS weekday
  WHERE NOT EXISTS (SELECT 1 FROM school_operating_days sod WHERE sod.school_id=p.school_id AND sod.is_operating_day=TRUE)
) d
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS class_period_days_weekday_idx
  ON class_period_days(school_id, weekday, period_id);

COMMENT ON TABLE school_operating_days IS 'School-specific operating weekdays; supports any combination Monday through Sunday.';
COMMENT ON TABLE timetable_templates IS 'Reusable timetable patterns such as morning, afternoon, regular, or weekend shifts.';
COMMENT ON TABLE timetable_template_periods IS 'Ordered time blocks belonging to a reusable timetable template.';
COMMENT ON TABLE school_calendar_exceptions IS 'Date-specific closures, additional operating days, special classes, and shortened days.';
COMMENT ON TABLE class_period_days IS 'Recurring weekdays for an actual class schedule; independent of period labels.';
