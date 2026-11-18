-- One-time, school-scoped MNCHS pilot attendance reset, authorized 2026-11-19.
-- This migration is deliberately constrained by an exact production school UUID,
-- school code AND name. It does nothing to other school tenants or fresh installs.
-- All deleted live records are archived first, within the same transaction.
-- Retain students, staff/parent accounts, credentials, enrollment, school years,
-- classes, timetables, staff schedules, approved leaves, OB requests, and audit logs.
-- Archives are protected database records, not downloadable/offsite backups.
CREATE TABLE IF NOT EXISTS attendance_pilot_reset_runs (
  reset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
  school_code text NOT NULL,
  reason text NOT NULL,
  archived_rows bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (school_id, reason)
);

CREATE TABLE IF NOT EXISTS attendance_pilot_reset_backup_rows (
  backup_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reset_id uuid NOT NULL REFERENCES attendance_pilot_reset_runs(reset_id) ON DELETE RESTRICT,
  source_table text NOT NULL,
  source_row jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS attendance_pilot_reset_backup_by_run_idx
  ON attendance_pilot_reset_backup_rows(reset_id, source_table);

DO $mnchs_reset$
DECLARE
  v_school_id uuid;
  v_reset_id uuid;
  v_school_name text;
  v_school_users bigint;
  v_student_accounts bigint;
  v_students bigint;
  v_student_enrollments bigint;
  v_remaining bigint;
  v_table text;
  v_archived bigint;
  v_reason constant text := 'MNCHS pilot attendance-only reset 2026-11-19';
BEGIN
  SELECT school_id, school_name
    INTO v_school_id, v_school_name
    FROM schools
   WHERE school_code='MNCHS'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'MNCHS not present; attendance-only pilot reset skipped.';
    RETURN;
  END IF;
  IF v_school_id <> '63643724-c50d-4859-aa42-c54818c2a152'::uuid
     OR v_school_name <> 'MATI NATIONAL COMPREHENSIVE HIGH SCHOOL' THEN
    RAISE EXCEPTION 'MNCHS pilot attendance reset aborted: school identity mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_pilot_reset_runs
              WHERE school_id=v_school_id AND reason=v_reason) THEN
    RAISE NOTICE 'MNCHS attendance pilot reset has already been completed; no further rows deleted.';
    RETURN;
  END IF;

  -- Block concurrent writes during the brief snapshot-and-delete transaction.
  -- Other schools are not deleted or modified by any statement below.
  LOCK TABLE attendance_events, teacher_gate_events, class_qr_checkins, class_qr_sessions, class_attendance_finalizations, class_attendance_finalization_events, manual_attendance_marks, manual_attendance_notes, sf2_daily_overrides, sf2_submissions, sardo_followup_events, sardo_followups, staff_attendance_events, staff_attendance_challenges, staff_attendance_challenge_redemptions, staff_form48_monthly_reviews, school_cloud_sync_outbox, sms_outbox IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_school_users FROM school_users WHERE school_id=v_school_id;
  SELECT count(*) INTO v_student_accounts FROM student_accounts WHERE school_id=v_school_id;
  SELECT count(*) INTO v_students FROM students WHERE school_id=v_school_id;
  SELECT count(*) INTO v_student_enrollments FROM student_enrollments WHERE school_id=v_school_id;

  INSERT INTO attendance_pilot_reset_runs(school_id, school_code, reason)
  VALUES (v_school_id, 'MNCHS', v_reason) RETURNING reset_id INTO v_reset_id;

  FOREACH v_table IN ARRAY ARRAY['attendance_events', 'teacher_gate_events', 'class_qr_checkins', 'class_qr_sessions', 'class_attendance_finalizations', 'class_attendance_finalization_events', 'manual_attendance_marks', 'manual_attendance_notes', 'sf2_daily_overrides', 'sf2_submissions', 'sardo_followup_events', 'sardo_followups', 'staff_attendance_events', 'staff_attendance_challenges', 'staff_attendance_challenge_redemptions', 'staff_form48_monthly_reviews', 'school_cloud_sync_outbox'] LOOP
    EXECUTE format(
      'INSERT INTO attendance_pilot_reset_backup_rows(reset_id,source_table,source_row)
       SELECT $1,%L,to_jsonb(t) FROM %I t WHERE t.school_id=$2', v_table, v_table
    ) USING v_reset_id, v_school_id;
  END LOOP;
  -- SMS records are keyed by event_id, with no school_id column.
  INSERT INTO attendance_pilot_reset_backup_rows(reset_id,source_table,source_row)
  SELECT v_reset_id,'sms_outbox',to_jsonb(so)
    FROM sms_outbox so
    JOIN attendance_events ae ON ae.event_id=so.event_id
   WHERE ae.school_id=v_school_id;

  SELECT count(*) INTO v_archived
    FROM attendance_pilot_reset_backup_rows WHERE reset_id=v_reset_id;
  UPDATE attendance_pilot_reset_runs SET archived_rows=v_archived WHERE reset_id=v_reset_id;

  -- Purge dependent check-ins/redemptions before the QR sessions / events.
  DELETE FROM sms_outbox so USING attendance_events ae
   WHERE so.event_id=ae.event_id AND ae.school_id=v_school_id;
  DELETE FROM staff_attendance_challenge_redemptions WHERE school_id=v_school_id;
  DELETE FROM staff_attendance_events WHERE school_id=v_school_id;
  DELETE FROM staff_attendance_challenges WHERE school_id=v_school_id;
  DELETE FROM teacher_gate_events WHERE school_id=v_school_id;
  DELETE FROM class_qr_checkins WHERE school_id=v_school_id;
  DELETE FROM class_qr_sessions WHERE school_id=v_school_id;
  DELETE FROM class_attendance_finalization_events WHERE school_id=v_school_id;
  DELETE FROM class_attendance_finalizations WHERE school_id=v_school_id;
  DELETE FROM manual_attendance_marks WHERE school_id=v_school_id;
  DELETE FROM manual_attendance_notes WHERE school_id=v_school_id;
  DELETE FROM sf2_daily_overrides WHERE school_id=v_school_id;
  DELETE FROM sf2_submissions WHERE school_id=v_school_id;
  DELETE FROM sardo_followup_events WHERE school_id=v_school_id;
  DELETE FROM sardo_followups WHERE school_id=v_school_id;
  DELETE FROM school_cloud_sync_outbox WHERE school_id=v_school_id;
  DELETE FROM attendance_events WHERE school_id=v_school_id;
  DELETE FROM staff_form48_monthly_reviews WHERE school_id=v_school_id;

  -- Verify no attendance rows remain in active tables.
  FOREACH v_table IN ARRAY ARRAY['attendance_events', 'teacher_gate_events', 'class_qr_checkins', 'class_qr_sessions', 'class_attendance_finalizations', 'class_attendance_finalization_events', 'manual_attendance_marks', 'manual_attendance_notes', 'sf2_daily_overrides', 'sf2_submissions', 'sardo_followup_events', 'sardo_followups', 'staff_attendance_events', 'staff_attendance_challenges', 'staff_attendance_challenge_redemptions', 'staff_form48_monthly_reviews', 'school_cloud_sync_outbox'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE school_id=$1', v_table)
      INTO v_remaining USING v_school_id;
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'MNCHS pilot reset failed verification for table %: % rows remain',
                      v_table, v_remaining;
    END IF;
  END LOOP;

  -- Guard rail: no account, student, or enrollment count may change.
  IF v_school_users <> (SELECT count(*) FROM school_users WHERE school_id=v_school_id)
     OR v_student_accounts <> (SELECT count(*) FROM student_accounts WHERE school_id=v_school_id)
     OR v_students <> (SELECT count(*) FROM students WHERE school_id=v_school_id)
     OR v_student_enrollments <> (SELECT count(*) FROM student_enrollments WHERE school_id=v_school_id) THEN
    RAISE EXCEPTION 'MNCHS pilot attendance reset aborted: account/enrollment preservation check failed';
  END IF;

  UPDATE attendance_pilot_reset_runs
     SET completed_at=clock_timestamp()
   WHERE reset_id=v_reset_id;
  RAISE NOTICE 'MNCHS attendance-only pilot reset complete; archived % records with reset %',
               v_archived, v_reset_id;
END;
$mnchs_reset$;
