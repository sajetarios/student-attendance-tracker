CREATE TABLE IF NOT EXISTS school_sections (
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 grade_level VARCHAR(40) NOT NULL,
 section_name VARCHAR(100) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (school_id,grade_level,section_name)
);
CREATE INDEX IF NOT EXISTS school_sections_lookup ON school_sections(school_id,grade_level) WHERE active=TRUE;
