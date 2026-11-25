-- Immutable versions of centrally reviewed, normalized blank forms.
CREATE TABLE IF NOT EXISTS locator_template_versions (
 template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source_request_id UUID NOT NULL UNIQUE,
 region TEXT NOT NULL CHECK(length(region) BETWEEN 1 AND 120),
 division TEXT NOT NULL CHECK(length(division) BETWEEN 1 AND 160),
 pdf_bytes BYTEA NOT NULL CHECK(octet_length(pdf_bytes) BETWEEN 1 AND 5242880),
 pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
 mapping JSONB NOT NULL CHECK(jsonb_typeof(mapping)='object'),
 published_by UUID REFERENCES platform_users(user_id) ON DELETE SET NULL,
 published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS locator_template_versions_scope_idx ON locator_template_versions(lower(region),lower(division),published_at DESC);
