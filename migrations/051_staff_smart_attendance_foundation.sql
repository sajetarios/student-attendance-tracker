-- 050: additive foundation for verified four-slot staff DTR, physical movements,
-- rotating lunch challenges, official business, and department coverage.
-- No existing gate events or student attendance rows are rewritten.
CREATE TABLE staff_attendance_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 staff_user_id UUID NOT NULL,
 event_kind TEXT NOT NULL CHECK (event_kind IN ('DTR_SLOT','GATE_MOVEMENT')),
 dtr_slot TEXT CHECK (dtr_slot IN ('AM_IN','AM_OUT','PM_IN','PM_OUT')),
 gate_direction TEXT CHECK (gate_direction IN ('IN','OUT')),
 school_date DATE NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 source TEXT NOT NULL CHECK (source IN ('GATEKEEPER','SELF_SERVICE','OFFLINE_SYNC','AUTHORIZED_CORRECTION','LEGACY_IMPORT')),
 verification_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
   CHECK (verification_status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
 verification_method TEXT CHECK (verification_method IN ('GUARD_PHOTO','ROTATING_QR','MANUAL_REVIEW','LEGACY')),
 actor_user_id UUID NOT NULL,
 client_event_key UUID NOT NULL,
 device_capture_at TIMESTAMPTZ,
 legacy_gate_event_id UUID,
 notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((event_kind='DTR_SLOT' AND dtr_slot IS NOT NULL AND gate_direction IS NULL)
     OR (event_kind='GATE_MOVEMENT' AND gate_direction IS NOT NULL AND dtr_slot IS NULL)),
 CHECK (verification_status <> 'VERIFIED' OR verification_method IS NOT NULL),
 UNIQUE(school_id,client_event_key),
 UNIQUE(school_id,event_id),
 FOREIGN KEY(school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,actor_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(legacy_gate_event_id) REFERENCES teacher_gate_events(event_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX staff_dtr_one_verified_slot_per_day
 ON staff_attendance_events(school_id,staff_user_id,school_date,dtr_slot)
 WHERE event_kind='DTR_SLOT' AND verification_status='VERIFIED';
CREATE INDEX staff_attendance_day_idx ON staff_attendance_events(school_id,staff_user_id,school_date,occurred_at);

CREATE TABLE staff_attendance_challenges (
 challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 presenter_user_id UUID NOT NULL,
 dtr_slot TEXT NOT NULL CHECK(dtr_slot IN ('AM_OUT','PM_IN')),
 school_date DATE NOT NULL,
 challenge_hash TEXT NOT NULL UNIQUE,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 CHECK(expires_at > issued_at AND expires_at <= issued_at + INTERVAL '5 minutes'),
 UNIQUE(school_id,challenge_id),
 FOREIGN KEY(school_id,presenter_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE staff_attendance_challenge_redemptions (
 school_id UUID NOT NULL,
 challenge_id UUID NOT NULL,
 staff_user_id UUID NOT NULL,
 event_id UUID NOT NULL,
 redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(school_id,challenge_id,staff_user_id),
 UNIQUE(school_id,event_id),
 FOREIGN KEY(school_id,challenge_id) REFERENCES staff_attendance_challenges(school_id,challenge_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,event_id) REFERENCES staff_attendance_events(school_id,event_id) ON DELETE RESTRICT
);

CREATE TABLE staff_official_business_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 staff_user_id UUID NOT NULL,
 department_id UUID NOT NULL,
 purpose TEXT NOT NULL CHECK(length(btrim(purpose)) BETWEEN 3 AND 1000),
 destination TEXT NOT NULL CHECK(length(btrim(destination)) BETWEEN 2 AND 300),
 starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING_HEAD'
   CHECK(status IN ('PENDING_HEAD','PENDING_ADMIN','APPROVED','REJECTED','CANCELLED')),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 head_user_id UUID,
 head_decided_at TIMESTAMPTZ,
 admin_user_id UUID,
 admin_decided_at TIMESTAMPTZ,
 decision_note TEXT,
 CHECK(ends_at > starts_at),
 CHECK((head_user_id IS NULL) = (head_decided_at IS NULL)),
 CHECK((admin_user_id IS NULL) = (admin_decided_at IS NULL)),
 UNIQUE(school_id,request_id),
 FOREIGN KEY(school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,department_id) REFERENCES school_departments(school_id,department_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,head_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,admin_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX staff_ob_review_idx ON staff_official_business_requests(school_id,department_id,status,starts_at);

CREATE TABLE staff_ob_class_coverage (
 coverage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 request_id UUID NOT NULL,
 period_id UUID NOT NULL,
 class_date DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'NEEDS_COVERAGE'
  CHECK(status IN ('NEEDS_COVERAGE','SUBSTITUTE_ASSIGNED','RESCHEDULED','CANCELLED')),
 substitute_user_id UUID,
 assigned_by_user_id UUID,
 assigned_at TIMESTAMPTZ,
 UNIQUE(school_id,request_id,period_id,class_date),
 CHECK(status <> 'SUBSTITUTE_ASSIGNED' OR (substitute_user_id IS NOT NULL AND assigned_by_user_id IS NOT NULL)),
 FOREIGN KEY(school_id,request_id) REFERENCES staff_official_business_requests(school_id,request_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,period_id) REFERENCES class_periods(school_id,period_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,substitute_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,assigned_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX staff_ob_coverage_status_idx ON staff_ob_class_coverage(school_id,status,class_date);

CREATE TABLE staff_attendance_audit (
 audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 action TEXT NOT NULL,
 target_type TEXT NOT NULL,
 target_id UUID NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(school_id,actor_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX staff_attendance_audit_target_idx ON staff_attendance_audit(school_id,target_type,target_id,created_at);
COMMENT ON TABLE staff_attendance_events IS 'Append-only source ledger; DTR slot projections must use verified entries only. Physical movements are distinct.';
COMMENT ON TABLE staff_attendance_challenges IS 'Store only challenge hashes; presenters must be authorized by API. Never expose plaintext tokens in database.';
COMMENT ON TABLE staff_attendance_audit IS 'Application must append audit rows transactionally for every state transition; no silent updates.';

-- Enforce append-only audit at database level, including privileged application bugs.
CREATE OR REPLACE FUNCTION staff_attendance_reject_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Staff attendance audit history is append-only';
END;
$$;
CREATE TRIGGER staff_attendance_audit_immutable
 BEFORE UPDATE OR DELETE ON staff_attendance_audit
 FOR EACH ROW EXECUTE FUNCTION staff_attendance_reject_audit_mutation();
