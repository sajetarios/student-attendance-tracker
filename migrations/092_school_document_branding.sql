ALTER TABLE schools ADD COLUMN IF NOT EXISTS document_branding JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS document_agency_logo BYTEA;
