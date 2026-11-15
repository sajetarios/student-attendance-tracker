-- The platform Super Admin has no school_id and therefore needs dedicated photo storage.
-- All image bytes remain private in PostgreSQL, with the same limits as school photos.
CREATE TABLE IF NOT EXISTS platform_profile_photos (
  platform_user_id UUID PRIMARY KEY REFERENCES platform_users(user_id) ON DELETE CASCADE,
  original_data BYTEA NOT NULL,
  image_data BYTEA NOT NULL,
  thumb_data BYTEA NOT NULL,
  original_mime TEXT NOT NULL CHECK (original_mime IN ('image/jpeg','image/png','image/webp')),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(original_data) <= 5242880),
  CHECK (octet_length(image_data) <= 1048576),
  CHECK (octet_length(thumb_data) <= 262144)
);
