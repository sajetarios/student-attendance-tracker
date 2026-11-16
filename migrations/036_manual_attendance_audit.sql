-- Immutable change audit for manual attendance corrections.
CREATE TABLE IF NOT EXISTS manual_attendance_audit (
 audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 school_id UUID NOT NULL,
 period_id UUID NOT NULL,
 student_id TEXT NOT NULL,
 school_date DATE NOT NULL,
 previous_status TEXT,
 new_status TEXT,
 previous_note TEXT,
 new_note TEXT,
 changed_by UUID NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE'))
);
CREATE INDEX IF NOT EXISTS manual_attendance_audit_lookup
 ON manual_attendance_audit(school_id,school_date,period_id,student_id,changed_at DESC);

CREATE OR REPLACE FUNCTION log_manual_attendance_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.note IS NOT DISTINCT FROM OLD.note
  THEN
    RETURN NEW;
  END IF;
  INSERT INTO manual_attendance_audit(
    school_id,period_id,student_id,school_date,previous_status,new_status,
    previous_note,new_note,changed_by,action)
  VALUES(NEW.school_id,NEW.period_id,NEW.student_id,NEW.school_date,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.note END,
    NEW.note,NEW.marked_by,TG_OP);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS manual_attendance_audit_trigger ON manual_attendance_marks;
CREATE TRIGGER manual_attendance_audit_trigger
 AFTER INSERT OR UPDATE ON manual_attendance_marks
 FOR EACH ROW EXECUTE FUNCTION log_manual_attendance_change();
