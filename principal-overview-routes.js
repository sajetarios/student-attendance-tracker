'use strict';
const {manilaDate}=require('./staff-lunch-routes');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAYS=new Set([7,14,30]);
function validSchoolDate(date,today){
 if(typeof date!=='string'||!DATE.test(date))return false;
 const parsed=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return false;
 const delta=(Date.parse(today+'T00:00:00Z')-parsed.getTime())/86400000;
 return delta>=0&&delta<=365;
}
function scopeParams(auth,query,today=manilaDate()){
 const schoolDate=query?.date===undefined?today:String(query.date);
 const range=query?.days===undefined?7:Number(query.days);
 const departmentId=query?.departmentId?String(query.departmentId):null;
 if(!validSchoolDate(schoolDate,today)||!DAYS.has(range)||
    (departmentId!==null&&!UUID.test(departmentId)))return null;
 return {schoolDate,range,departmentId};
}
const integer=value=>Number.parseInt(value,10)||0;
function registerPrincipalRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 // SCHOOL_ADMIN may preview the read-only leadership experience. This endpoint
 // grants no administrative writes to PRINCIPAL and never accepts a school ID
 // from the caller. Never infer absence from a missing QR/DTR event.
 app.get('/api/principal/overview',authenticateSchoolClient,
  requireSchoolRoles('PRINCIPAL','SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const params=scopeParams(req.auth,req.query);
  if(!params)return res.status(400).json({error:'Choose a valid school date within the last 365 days, a 7/14/30-day trend, and an optional department.'});
  const {schoolDate,range,departmentId}=params;
  const values=[req.auth.schoolId,schoolDate,departmentId];
  try {
   const [school,depts]=await Promise.all([
    pool.query(`SELECT school_name AS "schoolName",school_code AS "schoolCode"
     FROM schools WHERE school_id=$1 AND active=TRUE`,[req.auth.schoolId]),
    pool.query(`SELECT department_id AS "departmentId",department_name AS name
     FROM school_departments WHERE school_id=$1 AND active=TRUE
       AND department_code<>'UNASSIGNED' ORDER BY department_name LIMIT 100`,
      [req.auth.schoolId])
   ]);
   if(!school.rowCount)return res.status(404).json({error:'School unavailable.'});
   if(departmentId&&!depts.rows.some(d=>d.departmentId===departmentId))
    return res.status(404).json({error:'Department unavailable in your school.'});
   const [students,staffSummary,staffRows,departmentRows,trends,leaveRows,obRows,approvalDepartmentRows,locationSummary,classCheckins,earlyArrivals,watchNominees]=await Promise.all([
    pool.query(`SELECT
       (SELECT COUNT(*)::int FROM students st
          WHERE st.school_id=$1 AND st.active=TRUE) AS "activeStudentRecords",
       (SELECT school_year_label FROM school_years
          WHERE school_id=$1 AND status='ACTIVE' LIMIT 1) AS "activeSchoolYear",
       (SELECT COUNT(*)::int FROM student_enrollments en
          JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id AND sy.status='ACTIVE'
          JOIN students st ON st.school_id=en.school_id AND st.student_id=en.student_id AND st.active=TRUE
          WHERE en.school_id=$1 AND en.enrollment_status='ENROLLED') AS "activeYearEnrollment"`,
     [req.auth.schoolId]),
    pool.query(`WITH per_staff AS(
      SELECT u.user_id,
        COUNT(DISTINCT e.dtr_slot) FILTER(WHERE e.verification_status='VERIFIED')::int AS verified,
        COUNT(DISTINCT e.dtr_slot) FILTER(WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending
      FROM school_users u LEFT JOIN staff_attendance_events e
       ON e.school_id=u.school_id AND e.staff_user_id=u.user_id AND e.school_date=$2::date
       AND e.event_kind='DTR_SLOT' AND e.verification_status IN ('VERIFIED','PENDING_VERIFICATION')
      WHERE u.school_id=$1 AND u.active=TRUE AND u.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL')
       AND ($3::uuid IS NULL OR u.department_id=$3::uuid)
      GROUP BY u.user_id)
     SELECT COUNT(*)::int AS "trackedStaff",
       COUNT(*) FILTER(WHERE verified>0)::int AS "withVerifiedPunch",
       COUNT(*) FILTER(WHERE pending>0)::int AS "withPendingPunch",
       COALESCE(SUM(verified),0)::int AS "verifiedDtrSlots",
       COALESCE(SUM(pending),0)::int AS "pendingDtrSlots"
     FROM per_staff`,values),
    pool.query(`SELECT u.user_id AS "staffUserId",u.display_name AS name,
      u.role,d.department_name AS department,
      COALESCE(COUNT(DISTINCT e.dtr_slot) FILTER(WHERE e.verification_status='VERIFIED'),0)::int AS "verifiedSlots",
      COALESCE(COUNT(DISTINCT e.dtr_slot) FILTER(WHERE e.verification_status='PENDING_VERIFICATION'),0)::int AS "pendingSlots",
      EXISTS(SELECT 1 FROM staff_form48_approved_leaves l
        WHERE l.school_id=u.school_id AND l.staff_user_id=u.user_id
         AND l.revoked_at IS NULL AND l.start_date<=$2::date AND l.end_date>=$2::date) AS "approvedLeave"
     FROM school_users u
     LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
     LEFT JOIN staff_attendance_events e ON e.school_id=u.school_id
      AND e.staff_user_id=u.user_id AND e.school_date=$2::date AND e.event_kind='DTR_SLOT'
      AND e.verification_status IN ('VERIFIED','PENDING_VERIFICATION')
     WHERE u.school_id=$1 AND u.active=TRUE AND u.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL')
      AND ($3::uuid IS NULL OR u.department_id=$3::uuid)
     GROUP BY u.school_id,u.user_id,u.display_name,u.role,d.department_name
     ORDER BY "pendingSlots" DESC,"verifiedSlots" ASC,u.display_name LIMIT 200`,values),
    pool.query(`SELECT d.department_id AS "departmentId",d.department_name AS name,
      COUNT(DISTINCT u.user_id)::int AS "trackedStaff",
      COUNT(DISTINCT u.user_id) FILTER(WHERE e.verification_status='VERIFIED')::int AS "withVerifiedPunch",
      COUNT(DISTINCT u.user_id) FILTER(WHERE e.verification_status='PENDING_VERIFICATION')::int AS "withPendingPunch"
     FROM school_departments d
     LEFT JOIN school_users u ON u.school_id=d.school_id AND u.department_id=d.department_id
      AND u.active=TRUE AND u.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL')
     LEFT JOIN staff_attendance_events e ON e.school_id=d.school_id AND e.staff_user_id=u.user_id
      AND e.school_date=$2::date AND e.event_kind='DTR_SLOT'
      AND e.verification_status IN ('VERIFIED','PENDING_VERIFICATION')
     WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
     GROUP BY d.department_id,d.department_name ORDER BY d.department_name LIMIT 100`,
     [req.auth.schoolId,schoolDate]),
    pool.query(`SELECT to_char(day::date,'YYYY-MM-DD') AS date,
      COUNT(e.event_id) FILTER(WHERE e.verification_status='VERIFIED')::int AS verified,
      COUNT(e.event_id) FILTER(WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending
     FROM generate_series($2::date-($4::int-1),$2::date,interval '1 day') AS days(day)
     LEFT JOIN staff_attendance_events e ON e.school_id=$1 AND e.school_date=day::date
       AND e.event_kind='DTR_SLOT' AND e.verification_status IN ('VERIFIED','PENDING_VERIFICATION')
       AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM school_users u WHERE u.school_id=e.school_id
        AND u.user_id=e.staff_user_id AND u.department_id=$3::uuid))
     GROUP BY day::date ORDER BY day::date`,[...values,range]),
    pool.query(`SELECT r.status,COUNT(*)::int AS total
     FROM staff_leave_requests r LEFT JOIN school_users u
      ON u.school_id=r.school_id AND u.user_id=r.staff_user_id
     WHERE r.school_id=$1 AND r.status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL')
       AND ($2::uuid IS NULL OR COALESCE(r.department_id,u.department_id)=$2::uuid)
     GROUP BY r.status`,[req.auth.schoolId,departmentId]),
    pool.query(`SELECT r.status,COUNT(*)::int AS total FROM staff_official_business_requests r
     JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id
     WHERE r.school_id=$1 AND r.status IN ('PENDING_HEAD','PENDING_ADMIN')
       AND ($2::uuid IS NULL OR u.department_id=$2::uuid)
     GROUP BY r.status`,[req.auth.schoolId,departmentId]),
    // Department-only source attribution. Never send applicant identity,
    // diagnosis, leave reason, uploaded evidence, or any approval capability.
    pool.query(`SELECT 'LEAVE'::text AS kind,r.status,
       d.department_id AS "departmentId",
       COALESCE(d.department_name,'Unassigned / unavailable department') AS "departmentName",
       COUNT(*)::int AS total
     FROM staff_leave_requests r
     LEFT JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id
     LEFT JOIN school_departments d ON d.school_id=r.school_id
       AND d.department_id=COALESCE(r.department_id,u.department_id)
     WHERE r.school_id=$1
       AND r.status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL')
       AND ($2::uuid IS NULL OR COALESCE(r.department_id,u.department_id)=$2::uuid)
     GROUP BY r.status,d.department_id,d.department_name
     UNION ALL
     SELECT 'OB'::text AS kind,r.status,
       d.department_id AS "departmentId",
       COALESCE(d.department_name,'Unassigned / unavailable department') AS "departmentName",
       COUNT(*)::int AS total
     FROM staff_official_business_requests r
     JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id
     LEFT JOIN school_departments d ON d.school_id=r.school_id AND d.department_id=u.department_id
     WHERE r.school_id=$1 AND r.status IN ('PENDING_HEAD','PENDING_ADMIN')
       AND ($2::uuid IS NULL OR u.department_id=$2::uuid)
     GROUP BY r.status,d.department_id,d.department_name
     ORDER BY kind,status,"departmentName"`,[req.auth.schoolId,departmentId]),
    pool.query(`SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER(WHERE approved.setting_value IS NOT NULL)::int AS approved,
       COUNT(*) FILTER(WHERE proposals.setting_value->>'status'='PENDING')::int AS pending
     FROM school_departments d
     LEFT JOIN school_settings approved
      ON approved.school_id=d.school_id AND approved.setting_key='staff_lunch_geo_'||d.department_id::text
     LEFT JOIN school_settings proposals
      ON proposals.school_id=d.school_id AND proposals.setting_key='staff_lunch_geo_proposal_'||d.department_id::text
     WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
       AND ($2::uuid IS NULL OR d.department_id=$2::uuid)`,[req.auth.schoolId,departmentId]),
    pool.query(`SELECT COUNT(DISTINCT e.student_id)::int AS "acceptedClassCheckins"
     FROM attendance_events e
     WHERE e.school_id=$1 AND e.school_date=$2::date
       AND e.attendance_scope IN ('CLASS','ADVISORY')
       AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED'`,
      [req.auth.schoolId,schoolDate]),
    // Recognition shortlist: verified physical entry only, not DTR approval or a
    // claim of punctuality against employee-specific schedules. Legacy photo-
    // confirmed scans count once only if they have not been migrated.
    pool.query(`WITH physical_entries AS (
      SELECT e.staff_user_id,e.occurred_at FROM staff_attendance_events e
      WHERE e.school_id=$1 AND e.school_date=$2::date
       AND e.event_kind='GATE_MOVEMENT' AND e.gate_direction='IN'
       AND e.verification_status='VERIFIED'
      UNION ALL
      SELECT t.teacher_user_id,t.occurred_at FROM teacher_gate_events t
      WHERE t.school_id=$1 AND t.school_date=$2::date
       AND t.event_type='TIME_IN' AND t.photo_verified=TRUE
       AND NOT EXISTS (
        SELECT 1 FROM staff_attendance_events e WHERE e.school_id=t.school_id
         AND e.legacy_gate_event_id=t.event_id
       )
    ), first_entries AS (
      SELECT staff_user_id,MIN(occurred_at) AS first_at FROM physical_entries
      GROUP BY staff_user_id
    )
    SELECT u.display_name AS name,d.department_name AS department,
      to_char(f.first_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS "arrivalTime"
    FROM first_entries f
    JOIN school_users u ON u.school_id=$1 AND u.user_id=f.staff_user_id
     AND u.active=TRUE AND u.role IN ('TEACHER','DEPARTMENT_HEAD')
    LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
    WHERE (f.first_at AT TIME ZONE 'Asia/Manila')::time < TIME '07:00'
      AND ($3::uuid IS NULL OR u.department_id=$3::uuid)
      AND NOT EXISTS (
       SELECT 1 FROM staff_form48_approved_leaves leave_record
       WHERE leave_record.school_id=$1 AND leave_record.staff_user_id=u.user_id
        AND leave_record.start_date<=$2::date AND leave_record.end_date>=$2::date
        AND leave_record.revoked_at IS NULL
      )
    ORDER BY f.first_at ASC,u.display_name ASC LIMIT 8`,values),
    // Provisional Watch Recognition eligibility. The 30-day count includes
    // ONLY distinct dates of photo-verified first gate entry before 07:00.
    // Never penalize missing scans or infer punctuality, attendance or conduct.
    pool.query(`WITH physical_entries AS (
      SELECT e.staff_user_id,e.school_date,e.occurred_at
      FROM staff_attendance_events e
      WHERE e.school_id=$1
        AND e.school_date BETWEEN $2::date-INTERVAL '29 days' AND $2::date
        AND e.event_kind='GATE_MOVEMENT' AND e.gate_direction='IN'
        AND e.verification_status='VERIFIED'
      UNION ALL
      SELECT t.teacher_user_id,t.school_date,t.occurred_at
      FROM teacher_gate_events t
      WHERE t.school_id=$1
        AND t.school_date BETWEEN $2::date-INTERVAL '29 days' AND $2::date
        AND t.event_type='TIME_IN' AND t.photo_verified=TRUE
        AND NOT EXISTS(
          SELECT 1 FROM staff_attendance_events e WHERE e.school_id=t.school_id
            AND e.legacy_gate_event_id=t.event_id
        )
    ), daily_first AS (
      SELECT staff_user_id,school_date,MIN(occurred_at) AS first_at
      FROM physical_entries GROUP BY staff_user_id,school_date
    ), qualified_days AS (
      SELECT f.staff_user_id,f.school_date,f.first_at
      FROM daily_first f
      WHERE (f.first_at AT TIME ZONE 'Asia/Manila')::time < TIME '07:00'
        AND NOT EXISTS (
          SELECT 1 FROM staff_form48_approved_leaves l
          WHERE l.school_id=$1 AND l.staff_user_id=f.staff_user_id
            AND l.start_date<=f.school_date AND l.end_date>=f.school_date
            AND l.revoked_at IS NULL
        )
    ), counted AS (
      SELECT staff_user_id,COUNT(*)::int AS "earlyDays",
        COUNT(DISTINCT date_trunc('week',school_date::timestamp))::int AS "activeWeeks",
        to_char(MAX(first_at) AT TIME ZONE 'Asia/Manila','HH24:MI') AS "latestEarlyTime",
        ROUND(AVG(EXTRACT(EPOCH FROM (first_at AT TIME ZONE 'Asia/Manila')::time))/60)::int AS avg_minutes
      FROM qualified_days GROUP BY staff_user_id
    )
    SELECT u.display_name AS name,d.department_name AS department,
      c."earlyDays",c."activeWeeks",c."latestEarlyTime"
    FROM counted c
    JOIN school_users u ON u.school_id=$1 AND u.user_id=c.staff_user_id
      AND u.active=TRUE AND u.role='TEACHER'
    LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
    WHERE c."earlyDays">=10 AND c."activeWeeks">=3
      AND ($3::uuid IS NULL OR u.department_id=$3::uuid)
    ORDER BY c."earlyDays" DESC,c.avg_minutes ASC,u.display_name ASC LIMIT 10`,values)
   ]);
   const leave=Object.fromEntries(leaveRows.rows.map(r=>[r.status,integer(r.total)]));
   const ob=Object.fromEntries(obRows.rows.map(r=>[r.status,integer(r.total)]));
   const metrics=staffSummary.rows[0]||{};
   return res.json({
    generatedAt:new Date().toISOString(),schoolDate,timezone:'Asia/Manila',
    trendDays:range,departmentId,
    school:school.rows[0],departments:depts.rows,
    enrollment:students.rows[0]||{},
    metrics:{
     trackedStaff:integer(metrics.trackedStaff),
     withVerifiedPunch:integer(metrics.withVerifiedPunch),
     withPendingPunch:integer(metrics.withPendingPunch),
     verifiedDtrSlots:integer(metrics.verifiedDtrSlots),
     pendingDtrSlots:integer(metrics.pendingDtrSlots),
     acceptedClassCheckins:integer(classCheckins.rows[0]?.acceptedClassCheckins)
    },
    approvals:{leave,ob,
      totalPending:Object.values(leave).reduce((a,b)=>a+b,0)+Object.values(ob).reduce((a,b)=>a+b,0)},
    approvalDepartments:approvalDepartmentRows.rows.map(r=>({
      kind:r.kind,status:r.status,departmentId:r.departmentId||null,
      departmentName:r.departmentName,total:integer(r.total)
    })),
    locationSetup:{
     total:integer(locationSummary.rows[0]?.total),
     approved:integer(locationSummary.rows[0]?.approved),
     pending:integer(locationSummary.rows[0]?.pending)
    },
    earlyArrivals:{cutoff:'07:00',entries:earlyArrivals.rows,source:'PHOTO_VERIFIED_GATE_ENTRY',timezone:'Asia/Manila'},
    watchNominees:{
      periodStart:new Date(Date.parse(schoolDate+'T00:00:00Z')-29*86400000).toISOString().slice(0,10),
      periodEnd:schoolDate,cutoff:'07:00',minimumEarlyDays:10,minimumDistinctWeeks:3,
      entries:watchNominees.rows,
      note:'Provisional shortlist only. Confirm assignments, schedules, scan evidence and the school recognition policy before any award.'
    },
    staffRows:staffRows.rows,staffRowsLimited:integer(metrics.trackedStaff)>staffRows.rows.length,
    departmentRows:departmentRows.rows,trends:trends.rows,
    definitions:{
     withVerifiedPunch:'Distinct active staff with at least one VERIFIED Form 48 DTR slot on the selected date. Not a presence or punctuality rate.',
     verifiedDtrSlots:'Count of VERIFIED four-slot Form 48 DTR events. Missing slots do not establish absence or lateness.',
     acceptedClassCheckins:'Distinct students with at least one ACCEPTED class/advisory TIME_IN QR event on the selected date. Not the official SF2 attendance total.',
     pendingApprovals:'Requests awaiting review or documented external decisions; not permissions granted to the Principal dashboard.',
     noData:'An empty activity result is not evidence of absence or of a school closure.'
    }
   });
  }catch(error){
   console.error('Principal oversight read failed:',error.message);
   return res.status(503).json({error:'Leadership data is temporarily unavailable. No estimates or substitute figures are shown.'});
  }
 });
}
module.exports={registerPrincipalRoutes,validSchoolDate,scopeParams};
