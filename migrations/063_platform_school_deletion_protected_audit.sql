-- Keep staff audit and closed-year records immutable during normal operations.
-- During a Super Admin school deletion, permit removing ONLY an exact row already
-- copied into the verified, transaction-held platform recovery snapshot.
-- The API sets a transaction-local backup id only after the snapshot is counted.
-- No global trigger disabling or permanent bypass is used.
CREATE OR REPLACE FUNCTION public.platform_school_deletion_row_is_archived(
  p_school_id UUID, p_source_table TEXT, p_original_row JSONB
) RETURNS BOOLEAN
LANGUAGE SQL STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_school_deletion_backups b
    JOIN public.platform_school_deletion_backup_rows r ON r.backup_id = b.backup_id
    WHERE b.backup_id::text = NULLIF(current_setting('attendigo.platform_school_deletion_backup_id', true), '')
      AND b.school_id = p_school_id
      AND b.row_count > 0
      AND r.source_table = p_source_table
      AND r.row_data = p_original_row
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_attendance_reject_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.platform_school_deletion_row_is_archived(
    OLD.school_id, TG_TABLE_NAME, to_jsonb(OLD)
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Staff attendance audit history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_closed_school_year_records()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  year_status VARCHAR(12);
BEGIN
  -- Verified school deletion must not be prevented by normal closed-year
  -- immutability: that specific original row is already in the recovery snapshot.
  IF TG_OP = 'DELETE' AND public.platform_school_deletion_row_is_archived(
    OLD.school_id, TG_TABLE_NAME, to_jsonb(OLD)
  ) THEN
    RETURN OLD;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO year_status
      FROM school_years
      WHERE school_id = OLD.school_id AND school_year_id = OLD.school_year_id
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Original school year does not exist';
    END IF;
    IF year_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Records in a closed school year are read-only';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO year_status
      FROM school_years
      WHERE school_id = NEW.school_id AND school_year_id = NEW.school_year_id
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destination school year does not exist';
    END IF;
    IF year_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Records in a closed school year are read-only';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_student_special_program_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  y_status VARCHAR(12);
  y_start DATE;
  y_end DATE;
BEGIN
  IF TG_OP = 'DELETE' AND public.platform_school_deletion_row_is_archived(
    OLD.school_id, TG_TABLE_NAME, to_jsonb(OLD)
  ) THEN
    RETURN OLD;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO y_status FROM school_years
      WHERE school_id = OLD.school_id AND school_year_id = OLD.school_year_id FOR SHARE;
    IF y_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Records in a closed school year are read-only';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, start_date, end_date INTO y_status, y_start, y_end
      FROM school_years
      WHERE school_id = NEW.school_id AND school_year_id = NEW.school_year_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'School year not found'; END IF;
    IF y_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Records in a closed school year are read-only';
    END IF;
    IF NEW.start_date NOT BETWEEN y_start AND y_end OR
       (NEW.end_date IS NOT NULL AND NEW.end_date NOT BETWEEN y_start AND y_end) THEN
      RAISE EXCEPTION 'Special-program dates must be within the school year';
    END IF;
    NEW.updated_at = NOW();
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
