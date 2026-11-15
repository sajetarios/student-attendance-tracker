-- Durable official square photos and reviewable self-service photo replacement requests.
-- Binary data is private in PostgreSQL rather than transient instance storage.
CREATE TABLE IF NOT EXISTS official_profile_photos (
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 subject_kind TEXT NOT NULL CHECK (subject_kind IN ('STUDENT','STAFF','PARENT')),
 subject_id TEXT NOT NULL,
 original_data BYTEA NOT NULL,
 image_data BYTEA NOT NULL,
 thumb_data BYTEA NOT NULL,
 original_mime TEXT NOT NULL CHECK (original_mime IN ('image/jpeg','image/png','image/webp')),
 image_mime TEXT NOT NULL DEFAULT 'image/webp',
 modified_by_user_id UUID,
 modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,subject_kind,subject_id),
 CHECK(octet_length(original_data) <= 5242880),
 CHECK(octet_length(image_data) <= 1048576),
 CHECK(octet_length(thumb_data) <= 262144)
);
CREATE TABLE IF NOT EXISTS profile_photo_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 subject_kind TEXT NOT NULL CHECK (subject_kind IN ('STUDENT','STAFF')),
 subject_id TEXT NOT NULL,
 requested_by_user_id UUID,
 requested_by_student_account_id UUID,
 original_data BYTEA NOT NULL,
 image_data BYTEA NOT NULL,
 thumb_data BYTEA NOT NULL,
 original_mime TEXT NOT NULL CHECK (original_mime IN ('image/jpeg','image/png','image/webp')),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 reviewed_by UUID,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(octet_length(original_data) <= 5242880),
 CHECK(octet_length(image_data) <= 1048576),
 CHECK(octet_length(thumb_data) <= 262144),
 CHECK ((requested_by_user_id IS NOT NULL)::int+(requested_by_student_account_id IS NOT NULL)::int=1)
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_photo_one_pending ON profile_photo_requests(school_id,subject_kind,subject_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS profile_photo_requests_school_status_idx ON profile_photo_requests(school_id,status,created_at DESC);
