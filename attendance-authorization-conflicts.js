'use strict';
// Shared transaction lock: all official authorization writers use the existing
// employee leave lock. Call inside BEGIN, before checking/committing approval.
async function lockStaffAuthorization(db,schoolId,staffId){
 if(!schoolId||!staffId)throw Error('Missing authorization scope');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[schoolId+':leave:'+staffId]);
}
const effectiveEnd=alias=>`CASE WHEN ${alias}.completion_status='VERIFIED' THEN GREATEST(${alias}.ends_at,${alias}.completion_at) ELSE ${alias}.ends_at END`;
// Date-only leave covers the whole Manila civil day. Do not infer partial days.
// Half-open intervals prevent collisions when an OB ends exactly at midnight.
async function approvedObOverlapsLeave(db,schoolId,staffId,from,to){
 const r=await db.query(`SELECT 1 FROM staff_official_business_requests o
 WHERE o.school_id=$1 AND o.staff_user_id=$2 AND o.status='APPROVED'
 AND o.starts_at < (($4::date+1)::timestamp AT TIME ZONE 'Asia/Manila')
 AND (${effectiveEnd('o')}) > ($3::date::timestamp AT TIME ZONE 'Asia/Manila')
 LIMIT 1`,[schoolId,staffId,from,to]);
 return r.rowCount>0;
}
// Called after the authorized state update but before commit. If conflicting,
// the caller rolls back the update, evidence, audit and any coverage changes.
async function approvedObConflicts(db,schoolId,staffId,requestId){
 await lockStaffAuthorization(db,schoolId,staffId);
 const r=await db.query(`SELECT 1 FROM staff_official_business_requests current_ob
 WHERE current_ob.school_id=$1 AND current_ob.staff_user_id=$2 AND current_ob.request_id=$3
 AND current_ob.status='APPROVED' AND (
 EXISTS (SELECT 1 FROM staff_form48_approved_leaves l
 WHERE l.school_id=current_ob.school_id AND l.staff_user_id=current_ob.staff_user_id
 AND l.revoked_at IS NULL
 AND current_ob.starts_at < ((l.end_date+1)::timestamp AT TIME ZONE 'Asia/Manila')
 AND (${effectiveEnd('current_ob')}) > (l.start_date::timestamp AT TIME ZONE 'Asia/Manila'))
 OR EXISTS (SELECT 1 FROM staff_official_business_requests other
 WHERE other.school_id=current_ob.school_id AND other.staff_user_id=current_ob.staff_user_id
 AND other.request_id<>current_ob.request_id AND other.status='APPROVED'
 AND other.starts_at < (${effectiveEnd('current_ob')})
 AND (${effectiveEnd('other')}) > current_ob.starts_at))
 LIMIT 1`,[schoolId,staffId,requestId]);
 return r.rowCount>0;
}
module.exports={lockStaffAuthorization,approvedObOverlapsLeave,approvedObConflicts};
