-- 082: Link school calendar and class date-specific changes to published Principal memoranda.
-- New CLASS_SUSPENSION is learner-only, not a personnel closure. Preserve historical marks and DTR.
ALTER TABLE school_calendar_exceptions
 ADD COLUMN IF NOT EXISTS memo_id UUID,
 ADD COLUMN IF NOT EXISTS suspension_time TIME;
ALTER TABLE school_calendar_exceptions
 DROP CONSTRAINT IF EXISTS school_calendar_exceptions_exception_type_check;
ALTER TABLE school_calendar_exceptions
 DROP CONSTRAINT IF EXISTS school_calendar_exception_kind_check;
ALTER TABLE school_calendar_exceptions
 ADD CONSTRAINT school_calendar_exception_kind_check
 CHECK (exception_type IN ('CLOSED','OPEN','SPECIAL_CLASS','SHORTENED_DAY','CLASS_SUSPENSION'));
ALTER TABLE school_calendar_exceptions
 DROP CONSTRAINT IF EXISTS school_calendar_suspension_source_check;
ALTER TABLE school_calendar_exceptions
 ADD CONSTRAINT school_calendar_suspension_source_check
 CHECK ((exception_type <> 'CLASS_SUSPENSION' OR memo_id IS NOT NULL)
   AND (exception_type='CLASS_SUSPENSION' OR suspension_time IS NULL));
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='school_calendar_memo_fk') THEN
  ALTER TABLE school_calendar_exceptions ADD CONSTRAINT school_calendar_memo_fk
   FOREIGN KEY (school_id,memo_id) REFERENCES school_memoranda(school_id,memo_id) ON DELETE RESTRICT;
 END IF;
END $$;
ALTER TABLE schedule_day_adjustments ADD COLUMN IF NOT EXISTS memo_id UUID;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedule_day_adjustments_memo_fk') THEN
  ALTER TABLE schedule_day_adjustments ADD CONSTRAINT schedule_day_adjustments_memo_fk
   FOREIGN KEY (school_id,memo_id) REFERENCES school_memoranda(school_id,memo_id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS school_calendar_memo_link_idx ON school_calendar_exceptions(school_id,memo_id) WHERE memo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_adjustments_memo_link_idx ON schedule_day_adjustments(school_id,memo_id) WHERE memo_id IS NOT NULL;
COMMENT ON COLUMN school_calendar_exceptions.suspension_time IS 'Learner-class suspension begins at this Asia/Manila local clock time; NULL means full-day. Does not close staff workdays.';
COMMENT ON COLUMN school_calendar_exceptions.memo_id IS 'Published Principal memorandum authorizing this calendar exception. Archiving a memo does not silently erase recorded exceptions.';
