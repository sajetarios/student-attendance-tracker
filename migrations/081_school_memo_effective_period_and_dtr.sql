-- 081: Date-bounded Principal memorandum and optional prescribed Form 48 hours.
-- A notice does not modify any existing attendance event, manual review or QR gate log.
ALTER TABLE school_memoranda
 ADD COLUMN end_date DATE,
 ADD COLUMN dtr_hours JSONB;
ALTER TABLE school_memoranda
 ADD CONSTRAINT school_memos_date_range_chk
 CHECK (end_date IS NULL OR (effective_date IS NOT NULL AND end_date >= effective_date));
ALTER TABLE school_memoranda
 ADD CONSTRAINT school_memos_dtr_scope_chk
 CHECK (dtr_hours IS NULL OR (
   category = 'SCHEDULE_NOTICE' AND audience = 'SCHOOL_STAFF'
   AND effective_date IS NOT NULL AND end_date IS NOT NULL
   AND jsonb_typeof(dtr_hours) = 'object'
 ));
CREATE INDEX school_memos_dtr_effective_idx
 ON school_memoranda(school_id,effective_date,end_date)
 WHERE dtr_hours IS NOT NULL;
COMMENT ON COLUMN school_memoranda.end_date IS
 'Inclusive final effective school date. Memoranda remain viewable in history afterward.';
COMMENT ON COLUMN school_memoranda.dtr_hours IS
 'Principal-authorized, date-bounded prescribed Form 48 hours for school personnel; not an attendance punch or an automatic class suspension.';
