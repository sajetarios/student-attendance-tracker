'use strict';
// Read-only executive intelligence for authenticated School Admin accounts.
// The Principal role is NOT deployed; the preview never grants new write access.
// All figures are school-scoped, time-bounded, and sourced from persisted records.
const {manilaDate}=require('./staff-lunch-routes');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DAYS=new Set([1,7,30]);
const n=x=>Number(x)||0;
function rangeStart(end,days){
 const d=new Date(end+'T00:00:00Z');
 d.setUTCDate(d.getUTCDate()-(days-1));
 return d.toISOString().slice(0,10);
}
function registerPrincipalInsightsRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 app.get('/api/principal/insights',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const days=Number(req.query?.days||7);
  const dept=String(req.query?.departmentId||'').trim();
  if(!DAYS.has(days)||dept&&!UUID.test(dept))
   return res.status(400).json({error:'Choose 1, 7, or 30 days and a valid department.'});
  const today=manilaDate();
  const start=rangeStart(today,days);
  const departmentId=dept||null;
  const args=[req.auth.schoolId,start,today,departmentId];
  try{
   if(departmentId){
    const allowed=await pool.query(`SELECT 1 FROM school_departments
      WHERE school_id=$1 AND department_id=$2 AND active=TRUE`,
     [req.auth.schoolId,departmentId]);
    if(!allowed.rowCount)return res.status(404).json({error:'Department does not belong to your school.'});
   }
   const [staff,attendance,student,leave,ob,departments,trend,review]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total
      FROM school_users WHERE school_id=$1 AND active=TRUE
       AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN')
       AND ($4::uuid IS NULL OR department_id=$4)`,args),
    pool.query(`SELECT
       COUNT(*) FILTER (WHERE e.verification_status='VERIFIED')::int AS verified,
       COUNT(*) FILTER (WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending,
       COUNT(DISTINCT e.staff_user_id) FILTER (WHERE e.verification_status='VERIFIED')::int AS staff_with_verified,
       COUNT(DISTINCT e.staff_user_id) FILTER (WHERE e.verification_status='PENDING_VERIFICATION')::int AS staff_with_pending
      FROM staff_attendance_events e
      JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
      WHERE e.school_id=$1 AND e.school_date BETWEEN $2::date AND $3::date
       AND e.event_kind='DTR_SLOT'
       AND ($4::uuid IS NULL OR u.department_id=$4)`,args),
    // A school-level accepted TIME_IN proves recorded scan activity only.
    // Class-level scans, unscanned learners and absences are NOT inferred here.
    pool.query(`SELECT COUNT(*)::int AS scans,
      COUNT(DISTINCT (student_id,school_date))::int AS learner_days,
      COUNT(DISTINCT student_id)::int AS unique_learners
      FROM attendance_events
      WHERE school_id=$1 AND school_date BETWEEN $2::date AND $3::date
       AND attendance_scope='SCHOOL' AND event_type='TIME_IN'
       AND sync_status='ACCEPTED'`,args.slice(0,3)),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE status='PENDING_HEAD')::int AS head,
      COUNT(*) FILTER (WHERE status='PENDING_ADMIN')::int AS school,
      COUNT(*) FILTER (WHERE status='PENDING_EXTERNAL')::int AS official
      FROM staff_leave_requests
      WHERE school_id=$1 AND ($4::uuid IS NULL OR department_id=$4)`,args),
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE status='PENDING_HEAD')::int AS head,
      COUNT(*) FILTER (WHERE status='PENDING_ADMIN')::int AS school
      FROM staff_official_business_requests
      WHERE school_id=$1 AND ($4::uuid IS NULL OR department_id=$4)`,args),
    pool.query(`SELECT d.department_id AS "departmentId",d.department_name AS name,
       COUNT(DISTINCT u.user_id)::int AS staff,
       COUNT(DISTINCT e.event_id) FILTER (WHERE e.verification_status='VERIFIED')::int AS verified,
       COUNT(DISTINCT e.event_id) FILTER (WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending
      FROM school_departments d
      LEFT JOIN school_users u ON u.school_id=d.school_id AND u.department_id=d.department_id
       AND u.active=TRUE AND u.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN')
      LEFT JOIN staff_attendance_events e ON e.school_id=d.school_id AND e.staff_user_id=u.user_id
       AND e.event_kind='DTR_SLOT' AND e.school_date BETWEEN $2::date AND $3::date
       AND e.verification_status IN ('VERIFIED','PENDING_VERIFICATION')
      WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
      GROUP BY d.department_id,d.department_name ORDER BY d.department_name`,args),
    pool.query(`SELECT to_char(day.day::date,'YYYY-MM-DD') AS date,
      COUNT(e.event_id)::int AS verified
      FROM generate_series($2::date,$3::date,INTERVAL '1 day') day(day)
      LEFT JOIN staff_attendance_events e ON e.school_id=$1 AND e.school_date=day.day::date
       AND e.event_kind='DTR_SLOT' AND e.verification_status='VERIFIED'
       AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM school_users u
         WHERE u.school_id=e.school_id AND u.user_id=e.staff_user_id AND u.department_id=$4))
      GROUP BY day.day ORDER BY day.day`,args),
    pool.query(`SELECT e.event_id AS "eventId",u.display_name AS "staffName",
       e.dtr_slot AS slot,to_char(e.school_date,'YYYY-MM-DD') AS date,
       d.department_name AS department
      FROM staff_attendance_events e
      JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
      LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
      WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
       AND e.verification_status='PENDING_VERIFICATION'
       AND e.school_date BETWEEN $2::date AND $3::date
       AND ($4::uuid IS NULL OR u.department_id=$4)
      ORDER BY e.created_at DESC LIMIT 12`,args)
   ]);
   const a=attendance.rows[0]||{},l=leave.rows[0]||{},o=ob.rows[0]||{},st=student.rows[0]||{};
   res.json({
    generatedAt:new Date().toISOString(),schoolDate:today,from:start,to:today,
    days,departmentId,timezone:'Asia/Manila',scope:'SCHOOL_ADMIN_READ_ONLY_PREVIEW',
    staff:{active:n(staff.rows[0]?.total),verifiedSlots:n(a.verified),
     pendingSlots:n(a.pending),staffWithVerifiedSlot:n(a.staff_with_verified),
     staffWithPendingSlot:n(a.staff_with_pending)},
    students:{acceptedSchoolTimeInScans:n(st.scans),
     scannedLearnerDays:n(st.learner_days),uniqueLearnersScanned:n(st.unique_learners),
     scope:'SCHOOL_WIDE_ONLY'},
    approvals:{leave:{head:n(l.head),school:n(l.school),official:n(l.official)},
     ob:{head:n(o.head),school:n(o.school)}},
    departments:departments.rows.map(d=>({departmentId:d.departmentId,name:d.name,
     staff:n(d.staff),verifiedSlots:n(d.verified),pendingSlots:n(d.pending)})),
    trend:trend.rows.map(x=>({date:x.date,verifiedSlots:n(x.verified)})),
    reviewCases:review.rows,
    definitions:{
     verified:'Server-verified staff DTR slot events. Not a computed attendance rate.',
     pending:'Unverified staff DTR events requiring authorized review; not official Form 48 punches.',
     students:'Accepted school-level TIME_IN scans only. Missing scans do not prove absence.',
     leave:'Workflow status counts, not officially approved leave credits.',
     ob:'Pending OB requests only; not proof of employee absence.'
    }
   });
  }catch(err){
   console.error('Principal read-only insights:',err.code||err.message);
   return res.status(503).json({error:'Executive insights are temporarily unavailable. No school records were changed.'});
  }
 });
}
module.exports={registerPrincipalInsightsRoutes,rangeStart};
