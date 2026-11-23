-- 079: School memorandum publication, secure document storage, per-account read receipts.
-- Does not alter attendance, DTR, class schedules, or authorized suspension decisions.
CREATE TABLE IF NOT EXISTS school_memoranda (
 memo_id UUID NOT NULL DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 published_by UUID NOT NULL,
 title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 180),
 summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=1200),
 category TEXT NOT NULL CHECK(category IN ('GENERAL','SCHOOL_ADVISORY','SCHEDULE_NOTICE','CLASS_SUSPENSION')),
 audience TEXT NOT NULL CHECK(audience IN ('ALL_USERS','SCHOOL_STAFF')),
 effective_date DATE,
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),
 content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png')),
 content BYTEA NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 4194304),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 archived_at TIMESTAMPTZ,
 archived_by UUID,
 PRIMARY KEY(memo_id),
 UNIQUE(school_id,memo_id),
 FOREIGN KEY(school_id,published_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,archived_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS school_memoranda_live_idx
 ON school_memoranda(school_id,published_at DESC) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS school_memo_acknowledgments (
 school_id UUID NOT NULL,
 memo_id UUID NOT NULL,
 viewer_kind TEXT NOT NULL CHECK(viewer_kind IN ('SCHOOL_USER','STUDENT')),
 viewer_id UUID NOT NULL,
 acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(school_id,memo_id,viewer_kind,viewer_id),
 FOREIGN KEY(school_id,memo_id) REFERENCES school_memoranda(school_id,memo_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS school_memo_ack_rollup_idx
 ON school_memo_acknowledgments(school_id,memo_id,acknowledged_at);
CREATE TABLE IF NOT EXISTS school_memo_audit (
 audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 memo_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('PUBLISHED','ARCHIVED')),
 detail JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,memo_id) REFERENCES school_memoranda(school_id,memo_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,actor_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
COMMENT ON TABLE school_memoranda IS
 'Principal-published school notices, accessible to an explicitly selected audience. Publication alone cannot suspend classes or change DTR.';
COMMENT ON TABLE school_memo_acknowledgments IS
 'Explicit account acknowledgment, not inferred from notification delivery, display, download, or login.';
