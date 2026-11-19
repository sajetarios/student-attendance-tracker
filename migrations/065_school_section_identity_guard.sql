-- Prevent new equivalent school section names at the database boundary.
-- Existing data is not rewritten, merged, or deleted. Legacy suspected duplicates
-- remain available for read-only administrator review.
CREATE OR REPLACE FUNCTION school_section_identity_key(section_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(btrim(coalesce($1,''))), '[[:space:]._-]+', '', 'g');
$$;
CREATE INDEX IF NOT EXISTS school_sections_identity_lookup
 ON school_sections (school_id, lower(btrim(grade_level)), school_section_identity_key(section_name));

CREATE OR REPLACE FUNCTION guard_school_section_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same normalized identity can retain its history and metadata.
  IF TG_OP='UPDATE' AND NEW.school_id=OLD.school_id
    AND lower(btrim(NEW.grade_level))=lower(btrim(OLD.grade_level))
    AND school_section_identity_key(NEW.section_name)=school_section_identity_key(OLD.section_name)
  THEN RETURN NEW; END IF;
  -- This lock also protects paths which write directly to school_sections.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.school_id::text),16019);
  IF TG_OP='INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM school_sections ss WHERE ss.school_id=NEW.school_id
      AND lower(btrim(ss.grade_level))=lower(btrim(NEW.grade_level))
      AND school_section_identity_key(ss.section_name)=school_section_identity_key(NEW.section_name)
    ) THEN
      RAISE EXCEPTION 'This section already exists in the school-wide registry.'
       USING ERRCODE='23505';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM school_sections ss WHERE ss.school_id=NEW.school_id
      AND lower(btrim(ss.grade_level))=lower(btrim(NEW.grade_level))
      AND school_section_identity_key(ss.section_name)=school_section_identity_key(NEW.section_name)
      AND (ss.school_id,ss.grade_level,ss.section_name) IS DISTINCT FROM
          (OLD.school_id,OLD.grade_level,OLD.section_name)
    ) THEN
      RAISE EXCEPTION 'This section already exists in the school-wide registry.'
       USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS school_sections_identity_guard ON school_sections;
CREATE TRIGGER school_sections_identity_guard
 BEFORE INSERT OR UPDATE OF school_id,grade_level,section_name
 ON school_sections FOR EACH ROW EXECUTE FUNCTION guard_school_section_identity();
