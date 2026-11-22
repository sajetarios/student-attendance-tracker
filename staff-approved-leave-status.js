'use strict';
// Purely read-only leave-window lookup. Never toggles accounts or writes gate/DTR events.
// The authoritative source is the active, officially transcribed Form48 approval table.
const QUERY=String.raw\`
 SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Manila')::date,'YYYY-MM-DD') AS "schoolDate",
        to_char(l.start_date,'YYYY-MM-DD') AS "startDate",
        to_char(l.end_date,'YYYY-MM-DD') AS "endDate",
        l.leave_type AS "leaveType",l.approval_reference AS "approvalReference",
        s.teacher_status AS "legacyStatus",
        to_char(s.leave_start_date,'YYYY-MM-DD') AS "legacyStart",
        to_char(s.expected_return_date,'YYYY-MM-DD') AS "legacyEnd"
 FROM school_users s
 LEFT JOIN LATERAL (
   SELECT a.start_date,a.end_date,a.leave_type,a.approval_reference
   FROM staff_form48_approved_leaves a
   WHERE a.school_id=s.school_id AND a.staff_user_id=s.user_id
     AND a.revoked_at IS NULL AND
     a.end_date >= (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date
   ORDER BY
     CASE WHEN a.start_date <= (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date
       THEN 0 ELSE 1 END,
     a.start_date,a.end_date
   LIMIT 1
 ) l ON true
 WHERE s.school_id=$1 AND s.user_id=$2 AND s.active=TRUE
 LIMIT 1\`;
function dateValid(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);}
function deriveLeaveStatus(row){
 if(!row||!dateValid(row.schoolDate))return {status:'NONE'};
 const today=row.schoolDate;
 const official= dateValid(row.startDate)&&dateValid(row.endDate)&&row.startDate<=row.endDate;
 if(official&&row.startDate<=today&&row.endDate>=today)
  return {status:'ACTIVE',schoolDate:today,startDate:row.startDate,endDate:row.endDate,
   leaveType:row.leaveType||'OTHER',approvalReference:row.approvalReference||null};
 if(row.legacyStatus==='ON_LEAVE'&&dateValid(row.legacyStart)&&
    dateValid(row.legacyEnd)&&row.legacyStart<=today&&row.legacyEnd>=today)
  return {status:'ON_LEAVE_REVIEW',schoolDate:today,startDate:row.legacyStart,endDate:row.legacyEnd,
    leaveType:null,approvalReference:null};
 if(official&&row.startDate>today)
  return {status:'UPCOMING',schoolDate:today,startDate:row.startDate,endDate:row.endDate,
   leaveType:row.leaveType||'OTHER',approvalReference:row.approvalReference||null};
 return {status:'NONE',schoolDate:today,startDate:null,endDate:null,
  leaveType:null,approvalReference:null};
}
async function getStaffLeaveStatus(db,schoolId,staffUserId){
 const result=await db.query(QUERY,[schoolId,staffUserId]);
 return deriveLeaveStatus(result.rows[0]);
}
function gateVisibleLeave(status){
 const d=status||{status:'NONE'};
 return {status:d.status||'NONE',schoolDate:d.schoolDate||null,
  startDate:d.startDate||null,endDate:d.endDate||null,
  // Gatekeeper gets only proof of authorization; no leave type, reason, salary, or medical information.
  approvalReference:d.status==='ACTIVE'?d.approvalReference||null:null};
}
function requiresDtrReview(d){return d?.status==='ACTIVE'||d?.status==='ON_LEAVE_REVIEW';}
module.exports={QUERY,dateValid,deriveLeaveStatus,getStaffLeaveStatus,gateVisibleLeave,requiresDtrReview};
