-- Date-scoped adjustments layered over recurring weekday schedules.
-- One effective adjustment per class and calendar date. No history rewrite.
CREATE TABLE IF NOT EXISTS schedule_day_adjustments (
  adjustment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  period_id UUID NOT NULL,
  school_date DATE NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('SUBSTITUTE','REPLACE','RESCHEDULE','CANCEL')),
  teacher_user_id UUID,
  subject_id UUID,
  start_time TIME,
  end_time TIME,
  classroom TEXT CHECK (classroom IS NULL OR length(classroom)<=100),
  reason_type TEXT NOT NULL CHECK (reason_type IN ('SEMINAR','TRAINING','EXAMINATION','SPECIAL_ACTIVITY','LEAVE','OTHER')),
  notes TEXT CHECK (notes IS NULL OR length(notes)<=500),
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_adjustments_time_check CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  ),
  CONSTRAINT schedule_adjustments_period_fk FOREIGN KEY (school_id,period_id)
    REFERENCES class_periods(school_id,period_id) ON DELETE CASCADE,
  CONSTRAINT schedule_adjustments_teacher_fk FOREIGN KEY (school_id,teacher_user_id)
    REFERENCES school_users(school_id,user_id),
  CONSTRAINT schedule_adjustments_subject_fk FOREIGN KEY (school_id,subject_id)
    REFERENCES school_subjects(school_id,subject_id),
  CONSTRAINT schedule_adjustments_creator_fk FOREIGN KEY (school_id,created_by_user_id)
    REFERENCES school_users(school_id,user_id),
  UNIQUE (school_id,period_id,school_date)
);
CREATE INDEX IF NOT EXISTS schedule_day_adjustments_calendar_idx
 ON schedule_day_adjustments(school_id,school_date);
CREATE INDEX IF NOT EXISTS schedule_day_adjustments_teacher_idx
 ON schedule_day_adjustments(school_id,teacher_user_id,school_date);
COMMENT ON TABLE schedule_day_adjustments IS 'One-day or multi-date adjustments to recurring classes: seminar cover, subject replacement, time change, cancellation. Historical attendance is preserved.';
