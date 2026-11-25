-- Permit principal-issued text notices without a supporting file; reject incomplete attachment metadata.
ALTER TABLE school_memoranda DROP CONSTRAINT IF EXISTS school_memoranda_document_or_teaching_directive;
ALTER TABLE school_memoranda ADD CONSTRAINT school_memoranda_attachment_complete CHECK (
 (filename IS NOT NULL AND content_type IS NOT NULL AND content IS NOT NULL AND sha256 IS NOT NULL)
 OR (filename IS NULL AND content_type IS NULL AND content IS NULL AND sha256 IS NULL));
