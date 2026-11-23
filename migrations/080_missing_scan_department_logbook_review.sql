-- 080: documented missing-scan review, safe on preexisting staging schemas. Additive; never rewrite QR/gate history.
CREATE TABLE IF NOT EXISTS staff_missing_scan_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 staff_user_id UUID NOT NULL,
 department_id UUID NOT NULL,
 school_date DATE NOT NULL,
 slot TEXT NOT NULL CHECK(slot IN ('AM_IN','AM_OUT','PM_IN','PM_OUT')),
 claimed_time TIME NOT NULL,
 explanation TEXT NOT NULL CHECK(length(btrim(explanation)) BETWEEN 10 AND 1000),
 status TEXT NOT NULL DEFAULT 'PENDING_HEAD' CHECK(status IN
  ('PENDING_HEAD','NEEDS_EVIDENCE','HEAD_VERIFIED','HEAD_REJECTED',
   'DOCUMENTED','DTR_CORRECTED','ADMIN_REJECTED')),
 head_user_id UUID, head_note TEXT, head_reviewed_at TIMESTAMPTZ,
 verified_time TIME,
 evidence_reference TEXT,
 evidence_type TEXT CHECK(evidence_type IN ('image/jpeg','image/png','application/pdf')),
 evidence_bytes BYTEA,
 evidence_uploaded_by UUID, evidence_uploaded_at TIMESTAMPTZ,
 admin_user_id UUID, admin_note TEXT, admin_reviewed_at TIMESTAMPTZ,
 correction_event_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(school_id,request_id),
 FOREIGN KEY(school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,department_id) REFERENCES school_departments(school_id,department_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,head_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,evidence_uploaded_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,admin_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,correction_event_id) REFERENCES staff_attendance_events(school_id,event_id) ON DELETE RESTRICT,
 CHECK(status <> 'HEAD_VERIFIED' OR
  (head_user_id IS NOT NULL AND head_note IS NOT NULL AND verified_time IS NOT NULL
   AND evidence_bytes IS NOT NULL AND length(btrim(evidence_reference)) >= 2)),
 CHECK(status <> 'DTR_CORRECTED' OR correction_event_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_missing_scan_open_unique
 ON staff_missing_scan_requests(school_id,staff_user_id,school_date,slot)
 WHERE status IN ('PENDING_HEAD','NEEDS_EVIDENCE','HEAD_VERIFIED','DOCUMENTED','DTR_CORRECTED');
CREATE INDEX IF NOT EXISTS staff_missing_scan_review_queue
 ON staff_missing_scan_requests(school_id,department_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS staff_missing_scan_staff_lookup
 ON staff_missing_scan_requests(school_id,staff_user_id,school_date DESC);
CREATE TABLE IF NOT EXISTS staff_missing_scan_policies (
 school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE RESTRICT,
 mode TEXT NOT NULL DEFAULT 'DOCUMENT_EXCEPTION' CHECK(mode IN ('DOCUMENT_EXCEPTION','DTR_CORRECTION')),
 configured_by UUID,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,configured_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
COMMENT ON TABLE staff_missing_scan_requests IS
 'Department logbook-based verification; a documented exception is not an official QR or DTR punch.';
COMMENT ON TABLE staff_missing_scan_policies IS
 'Default DOCUMENT_EXCEPTION leaves Form 48 slot blank; school admin enables DTR_CORRECTION only when local SDO rules allow.';