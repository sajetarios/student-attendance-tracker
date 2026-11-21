-- Normalize only empty comma-separated components in existing LIS family names.
-- Preserve case, suffixes, identifiers, relationships, and original values in audit.
WITH changed AS (
 SELECT school_id,student_id,mother_maiden_name AS old_name,
 trim(both ', ' from regexp_replace(regexp_replace(mother_maiden_name, '[[:space:]]*,[[:space:]]*,+', ', ', 'g'), ',[[:space:]]*$', '', 'g')) AS new_name
 FROM students WHERE mother_maiden_name ~ ',[[:space:]]*,|,[[:space:]]*$'
), updated AS (
 UPDATE students s SET mother_maiden_name=c.new_name FROM changed c
 WHERE s.school_id=c.school_id AND s.student_id=c.student_id AND s.mother_maiden_name=c.old_name
 RETURNING s.school_id,s.student_id,c.old_name,c.new_name
)
INSERT INTO audit_logs(school_id,actor_type,action,entity_type,entity_id,details)
SELECT school_id,'SYSTEM','SF1_FAMILY_NAME_FORMAT_NORMALIZED','STUDENT',student_id,
 jsonb_build_object('field','mother_maiden_name','before',old_name,'after',new_name,'reason','Remove empty LIS SF1 name components; no identity or guardian relationship change')
FROM updated;
