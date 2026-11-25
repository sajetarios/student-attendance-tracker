-- One outstanding blank template request per school; no employee data.
CREATE TABLE IF NOT EXISTS school_locator_template_requests (
 school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
 request_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 division TEXT NOT NULL CHECK(length(division) BETWEEN 1 AND 160),
 region TEXT NOT NULL CHECK(length(region) BETWEEN 1 AND 120),
 pdf_bytes BYTEA NOT NULL CHECK(octet_length(pdf_bytes) BETWEEN 1 AND 5242880),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REVIEWED')),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reviewed_at TIMESTAMPTZ,
 reviewed_by UUID REFERENCES platform_users(user_id) ON DELETE SET NULL
);
