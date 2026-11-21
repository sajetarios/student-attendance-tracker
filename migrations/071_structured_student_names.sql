-- Structured DepEd learner names. No unverified token splitting is performed.
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS name_parts_source TEXT;
ALTER TABLE students ADD CONSTRAINT students_name_parts_source_check
  CHECK (name_parts_source IS NULL OR name_parts_source IN
    ('LEGACY_DELIMITED','SF1_VERIFIED','SF1_IMPORT','MANUAL'));
CREATE INDEX IF NOT EXISTS idx_students_school_last_first
  ON students(school_id,last_name,first_name);

-- Backfill only explicit comma-delimited surnames; ambiguous given/middle
-- boundaries remain NULL and will be resolved by source-backed import or editing.
UPDATE students SET
  last_name=NULLIF(BTRIM(split_part(full_name,',',1)),''),
  name_parts_source='LEGACY_DELIMITED'
WHERE full_name LIKE '%,%'
  AND NULLIF(BTRIM(split_part(full_name,',',1)),'') IS NOT NULL
  AND NULLIF(BTRIM(split_part(full_name,',',2)),'') IS NOT NULL
  AND last_name IS NULL AND first_name IS NULL AND name_parts_source IS NULL;

-- A private LIS SF1 (SY 2026-27, Grade 8 SPJ Tuvera) was independently
-- reconciled against all 28 production names and birthdates. The token
-- boundaries below come from that source; NO names, LRNs, DOBs are stored
-- in this migration. The fingerprint guards against subsequent user edits.
DO $sf1$
DECLARE
  target_school CONSTANT uuid := 'cf0dee5d-f4b3-403b-b6de-6aa1d49fea6e';
  expected CONSTANT text := 'cd4b65cca13bef1228f4ea1df40e002a';
  current_digest text;
  learner_count integer;
  eligible_count integer;
  changed_count integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM schools
   WHERE school_id=target_school AND school_code='MNCHS'
     AND school_name='Mati National Comprehensive High School') THEN
   RETURN;
 END IF;
 SELECT COUNT(*)::integer,
    md5(string_agg(student_id||'|'||full_name||'|'||birth_date::text||'|'||lrn,
       chr(10) ORDER BY student_id))
 INTO learner_count,current_digest
 FROM students WHERE school_id=target_school AND active=TRUE
   AND student_id BETWEEN '26-00001' AND '26-00028';
 IF learner_count<>28 OR current_digest IS DISTINCT FROM expected THEN
   RAISE NOTICE 'Source-verified SPJ Tuvera name-part backfill skipped: roster changed since comparison';
   RETURN;
 END IF;
 CREATE TEMP TABLE verified_tuvera_parts ON COMMIT DROP AS
 WITH verified_positions(student_id, first_words, has_middle) AS (
   VALUES
      ('26-00001', 2, TRUE),
      ('26-00002', 2, TRUE),
      ('26-00003', 2, TRUE),
      ('26-00004', 2, TRUE),
      ('26-00005', 1, TRUE),
      ('26-00006', 2, TRUE),
      ('26-00007', 1, TRUE),
      ('26-00008', 1, TRUE),
      ('26-00009', 2, TRUE),
      ('26-00010', 1, TRUE),
      ('26-00011', 2, TRUE),
      ('26-00012', 2, FALSE),
      ('26-00013', 1, TRUE),
      ('26-00014', 3, TRUE),
      ('26-00015', 1, TRUE),
      ('26-00016', 2, TRUE),
      ('26-00017', 2, TRUE),
      ('26-00018', 2, TRUE),
      ('26-00019', 2, TRUE),
      ('26-00020', 2, TRUE),
      ('26-00021', 2, TRUE),
      ('26-00022', 3, TRUE),
      ('26-00023', 1, FALSE),
      ('26-00024', 2, TRUE),
      ('26-00025', 2, FALSE),
      ('26-00026', 2, TRUE),
      ('26-00027', 2, TRUE),
      ('26-00028', 1, TRUE)
 ), name_tokens AS (
   SELECT s.student_id,s.school_id,s.full_name,p.first_words,p.has_middle,
    BTRIM(split_part(s.full_name,',',1)) AS surname,
    string_to_array(BTRIM(split_part(s.full_name,',',2)),' ') AS tokens
   FROM students s JOIN verified_positions p ON p.student_id=s.student_id
   WHERE s.school_id=target_school AND s.active=TRUE
 )
 SELECT student_id,school_id,full_name,surname,
   array_to_string(tokens[1:first_words],' ') AS given,
   CASE WHEN has_middle THEN array_to_string(
     tokens[first_words+1:array_length(tokens,1)],' ') ELSE NULL END AS middle,
   first_words,has_middle,array_length(tokens,1) AS word_count
 FROM name_tokens;
 SELECT COUNT(*)::integer INTO eligible_count
 FROM verified_tuvera_parts
 WHERE surname<>'' AND given<>'' AND length(surname)<=100
   AND length(given)<=160 AND length(coalesce(middle,''))<=160
   AND ((has_middle AND middle IS NOT NULL AND middle<>''
             AND word_count>first_words)
       OR (NOT has_middle AND word_count=first_words))
   AND full_name=surname||', '||given||
       CASE WHEN middle IS NOT NULL THEN ' '||middle ELSE '' END;
 IF eligible_count<>28 THEN
   RAISE EXCEPTION 'SF1 name parts did not pass 28 source-verified boundaries; no changes applied';
 END IF;
 UPDATE students s SET last_name=p.surname,first_name=p.given,
   middle_name=p.middle,name_parts_source='SF1_VERIFIED'
 FROM verified_tuvera_parts p
 WHERE s.school_id=p.school_id AND s.student_id=p.student_id
   AND s.full_name=p.full_name AND s.first_name IS NULL
   AND s.name_parts_source='LEGACY_DELIMITED';
 GET DIAGNOSTICS changed_count=ROW_COUNT;
 IF changed_count<>28 THEN
   RAISE EXCEPTION 'SF1 name-part update changed % instead of 28; no changes applied',changed_count;
 END IF;
 INSERT INTO audit_logs(school_id,actor_type,action,entity_type,entity_id,details)
 SELECT school_id,'SYSTEM','SF1_VERIFIED_NAME_PARTS_BACKFILL',
  'student',student_id,
  jsonb_build_object('source','DepEd LIS SF1 2026-2027 SPJ Tuvera',
    'nameParts','source-verified','identityChanged',FALSE)
 FROM verified_tuvera_parts;
END
$sf1$;
