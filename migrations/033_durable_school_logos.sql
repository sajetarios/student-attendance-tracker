-- School identity assets must survive Render instance restarts and redeploys.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_data BYTEA;
-- Existing filesystem-only logos cannot be recovered after a disk reset;
-- preserve the legacy path for auditing until a new logo is uploaded.
