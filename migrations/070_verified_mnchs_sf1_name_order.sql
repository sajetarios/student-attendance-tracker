-- Official DepEd LIS SF1, SY 2026–2027, Grade 8 SPJ Tuvera.
-- No learner names, dates of birth or LRNs from the private SF1 are embedded in source control.
-- This one-time, guarded reconciliation is only valid for the 28 production records
-- individually cross-checked against the user's SF1 by full name and birthdate.
-- It changes display-order text only; student IDs, LRNs, QR tokens, permissions,
-- school-year enrollment and attendance rows are left untouched.
DO $sf1$
DECLARE
  target_school CONSTANT uuid := 'cf0dee5d-f4b3-403b-b6de-6aa1d49fea6e';
  expected_fingerprint CONSTANT text := 'dc3cdd9b224bb15c3d3522bc20df40b2';
  actual_fingerprint text;
  matched_count integer;
  class_count integer;
  valid_identity_count integer;
  changed_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schools WHERE school_id=target_school
      AND school_code='MNCHS'
      AND school_name='Mati National Comprehensive High School'
  ) THEN
    RAISE NOTICE 'Verified SF1 roster correction skipped: exact target school is absent';
    RETURN;
  END IF;

  -- Fail closed if a single identity, DOB, LRN, or name has changed since
  -- the official SF1-to-production reconciliation; never guess a surname.
  SELECT COUNT(*)::integer,
         md5(string_agg(s.student_id || '|' || s.full_name || '|' ||
             s.birth_date::text || '|' || s.lrn, chr(10) ORDER BY s.student_id)),
         COUNT(*) FILTER (WHERE s.lrn ~ '^[0-9]{12}$' AND s.birth_date IS NOT NULL)::integer
    INTO matched_count, actual_fingerprint, valid_identity_count
    FROM students s
   WHERE s.school_id=target_school AND s.active=TRUE
     AND s.student_id BETWEEN '26-00001' AND '26-00028';

  IF matched_count<>28 OR valid_identity_count<>28 OR
     actual_fingerprint IS DISTINCT FROM expected_fingerprint THEN
    RAISE EXCEPTION 'SF1 name reconciliation halted: verified production roster changed; no names updated';
  END IF;

  SELECT COUNT(*)::integer INTO class_count
    FROM students s
    WHERE s.school_id=target_school AND s.active=TRUE
      AND s.student_id BETWEEN '26-00001' AND '26-00028'
      AND EXISTS (
        SELECT 1 FROM student_enrollments e
        JOIN school_years sy ON sy.school_id=e.school_id
          AND sy.school_year_id=e.school_year_id
        WHERE e.school_id=s.school_id AND e.student_id=s.student_id
          AND e.grade_level='Grade 8' AND lower(e.section)='spj tuvera'
          AND e.enrollment_status='ENROLLED' AND sy.status='ACTIVE'
      );
  IF class_count<>28 THEN
    RAISE EXCEPTION 'SF1 name reconciliation halted: active SPJ Tuvera scope changed; no names updated';
  END IF;

  CREATE TEMP TABLE sf1_verified_name_corrections ON COMMIT DROP AS
    SELECT s.school_id, s.student_id, s.full_name AS previous_name,
      regexp_replace(
        regexp_replace(s.full_name,
          '[[:space:]]+-[[:space:]]+([^[:space:]]+)$', ' \1'),
        '^(.*)[[:space:]]+([^[:space:]]+)$', '\2, \1'
      ) AS official_name
    FROM students s
    WHERE s.school_id=target_school AND s.active=TRUE
      AND s.student_id BETWEEN '26-00001' AND '26-00028';

  IF (SELECT COUNT(*) FROM sf1_verified_name_corrections
      WHERE official_name LIKE '%, %' AND official_name<>previous_name)<>28 THEN
    RAISE EXCEPTION 'SF1 name reconciliation halted: not all names can be safely reformatted';
  END IF;

  INSERT INTO audit_logs
    (school_id, actor_type, action, entity_type, entity_id, details)
  SELECT school_id, 'SYSTEM', 'SF1_VERIFIED_NAME_ORDER_CORRECTION', 'student',
         student_id,
         jsonb_build_object(
            'previousFullName', previous_name,
            'verifiedFullName', official_name,
            'source', 'DepEd LIS SF1 SY 2026-2027 Grade 8 SPJ Tuvera',
            'identityCheck', 'original full name and birthdate, unique 12-digit LRN present',
            'scope', '28 specifically verified MNCHS learners',
            'preserved', 'student ID, LRN, private QR, enrollment and attendance'
         )
    FROM sf1_verified_name_corrections;

  UPDATE students s
     SET full_name=c.official_name, updated_at=NOW()
    FROM sf1_verified_name_corrections c
   WHERE s.school_id=c.school_id AND s.student_id=c.student_id
     AND s.full_name=c.previous_name;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>28 THEN
    RAISE EXCEPTION 'SF1 name reconciliation halted: expected 28 updates, got %', changed_count;
  END IF;
END
$sf1$;
