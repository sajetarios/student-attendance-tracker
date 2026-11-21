-- Correct standalone LIS '-' placeholders in saved SF1 mother maiden names.
-- Preserve student identity, guardian links and attendance; audit before/after.
WITH candidates AS (
 SELECT school_id,student_id,mother_maiden_name AS old_name,
 array_to_string(ARRAY(
 SELECT btrim(part) FROM unnest(string_to_array(mother_maiden_name, ',')) AS part
 WHERE btrim(part) <> '' AND btrim(part) <> '-'
 ), ', ') AS new_name
 FROM students WHERE mother_maiden_name ~ ',[[:space:]]*-[[:space:]]*$'
), updated AS (
 UPDATE students s SET mother_maiden_name=c.new_name
 FROM candidates c WHERE s.school_id=c.school_id AND s.student_id=c.student_id
 AND s.mother_maiden_name=c.old_name AND c.new_name <> ''
 RETURNING s.school_id,s.student_id,c.old_name,c.new_name
)
INSERT INTO audit_logs(school_id,actor_type,action,entity_type,entity_id,details)
SELECT school_id,'SYSTEM','SF1_FAMILY_NAME_PLACEHOLDER_NORMALIZED','STUDENT',student_id,
jsonb_build_object('field','mother_maiden_name','before',old_name,'after',new_name,'reason','Standalone LIS dash placeholder removed; relationship unchanged')
FROM updated;
