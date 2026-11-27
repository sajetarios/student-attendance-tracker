-- Durable, append-only record of physically signed Form 48 PDFs.
-- This archive does not certify the current live calculation, grant approval,
-- create punches, or replace any existing report. Revisions are new records.
CREATE TABLE staff_form48_signed_archives (
 archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id uuid NOT NULL,
 staff_user_id uuid NOT NULL,
 report_month date NOT NULL CHECK(EXTRACT(DAY FROM report_month)=1),
 archive_version integer NOT NULL CHECK(archive_version>0),
 approval_reference text NOT NULL CHECK(length(btrim(approval_reference)) BETWEEN 3 AND 120),
 signed_on date NOT NULL,
 revision_reason text NOT NULL CHECK(length(btrim(revision_reason)) BETWEEN 3 AND 1000),
 recorded_by_user_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 file_bytes bytea NOT NULL,
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 file_size integer NOT NULL CHECK(file_size BETWEEN 5 AND 4194304 AND file_size=octet_length(file_bytes)),
 CHECK(recorded_by_user_id<>staff_user_id),
 UNIQUE(school_id,staff_user_id,report_month,archive_version),
 UNIQUE(school_id,staff_user_id,report_month,file_sha256),
 FOREIGN KEY(school_id,staff_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(school_id,recorded_by_user_id) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT
);
ALTER TABLE staff_form48_signed_archives ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION staff_form48_signed_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Signed Form 48 archive is append-only'; END;
$$;
CREATE TRIGGER staff_form48_signed_archive_no_mutation BEFORE UPDATE OR DELETE
 ON staff_form48_signed_archives FOR EACH ROW EXECUTE FUNCTION staff_form48_signed_archive_immutable();
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE staff_form48_signed_archives FROM anon;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE staff_form48_signed_archives FROM authenticated;
 END IF;
END $$;
