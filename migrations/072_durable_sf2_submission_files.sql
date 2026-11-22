-- Store official submitted SF2 workbooks with their database record.
-- Local files on Render Free are ephemeral. Legacy reports remain readable by
-- the old fallback until separately verified or migrated.
ALTER TABLE sf2_submissions
 ADD COLUMN IF NOT EXISTS file_bytes BYTEA,
 ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
 ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE sf2_submissions
 ADD CONSTRAINT sf2_durable_file_integrity_chk
 CHECK (file_bytes IS NULL OR
   (file_sha256 ~ '^[0-9a-f]{64}$'
    AND file_size = octet_length(file_bytes)
    AND file_size BETWEEN 1 AND 8388608));
COMMENT ON COLUMN sf2_submissions.file_bytes IS
 'Official submitted SF2 workbook stored transactionally with its record, protected by school-scoped backend authorization. Never write new submission files to Render local disk.';
