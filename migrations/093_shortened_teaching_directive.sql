-- A teaching-only directive may be published without an uploaded document.
ALTER TABLE school_memoranda ADD COLUMN IF NOT EXISTS class_period_minutes JSONB;
ALTER TABLE school_memoranda ALTER COLUMN filename DROP NOT NULL, ALTER COLUMN content_type DROP NOT NULL,
 ALTER COLUMN content DROP NOT NULL, ALTER COLUMN sha256 DROP NOT NULL;
ALTER TABLE school_memoranda ADD CONSTRAINT school_memoranda_document_or_teaching_directive CHECK (
 (filename IS NOT NULL AND content_type IS NOT NULL AND content IS NOT NULL AND sha256 IS NOT NULL)
 OR (filename IS NULL AND content_type IS NULL AND content IS NULL AND sha256 IS NULL AND class_period_minutes IS NOT NULL));
ALTER TABLE school_memoranda ADD CONSTRAINT school_memoranda_teaching_only CHECK (
 class_period_minutes IS NULL OR (category='SCHEDULE_NOTICE' AND audience='ALL_USERS' AND dtr_hours IS NULL
 AND effective_date IS NOT NULL AND end_date IS NOT NULL));
