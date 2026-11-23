'use strict';
// Read-only, school-scoped leadership analytics. No DTR or approval mutation
// endpoints are exposed to Principal accounts.
const {hashPassword}=require('./auth-security');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ALLOWED_DAYS=new Set([7,30,90]);
function manilaToday(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const byType=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return byType.year+'-'+byType.month+'-'+byType.day;
}
function numeric(row,field){return Number(row?.[field]||0);}
function registerPrincipalRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const principalOnly=[authenticateSchoolClient,requireSchoolRoles('PRINCIPAL')];
 // Restrict initial provisioning to School Admin; the new role cannot
 // escalate privileges by calling this or any existing management API.
 app.post('/api/principal/accounts',authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const username=String(req.body?.username||'').trim(),displayName=String(req.body?.displayName||'').trim();
  const password=req.body?.password;
  if(!/^[a-zA-Z0-9._-]{3,80}$/.test(username)||displayName.length<3||displayName.length>160||
     typeof password!=='string'||password.length<12||password.length>256)
   return res.status(400).json({error:'Enter a username (3–80 letters/numbers), a name, and a password of at least 12 characters.'});
  let passwordHash;
  try{passwordHash=await hashPassword(password);}
  catch(error){return res.status(400).json({error:error.message||'Password did not meet requirements.'});}
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const existing=await c.query(`SELECT COUNT(*)::int AS active_count FROM school_users
      WHERE school_id=$1 AND role='PRINCIPAL' AND active=TRUE`,[req.auth.schoolId]);
   if(numeric(existing.rows[0],'active_count')>=3){await c.query('ROLLBACK');
    return res.status(409).json({error:'This school already has three active Principal accounts. Review existing accounts before adding another.'});}
   const created=await c.query(`INSERT INTO school_users
     (school_id,username,display_name,password_hash,role,teacher_designations,must_change_password)
     VALUES($1,$2,$3,$4,'PRINCIPAL',ARRAY[]::text[],TRUE)
     RETURNING user_id AS "userId",username,display_name AS "displayName"`,
    [req.auth.schoolId,username,displayName,passwordHash]);
   await c.query(`INSERT INTO audit_logs
     (school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CREATE_PRINCIPAL','school_user',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,created.rows[0].userId,JSON.stringify({role:'PRINCIPAL'})]);
   await c.query('COMMIT');
   return res.status(201).json({account:created.rows[0],mustChangePassword:true,
    message:'Principal account created. The Principal must change their password at first sign-in.'});
  }catch(error){await c.query('ROLLBACK').catch(()=>{});
   if(error.code==='23505')return res.status(409).json({error:'This username is already used in the school.'});
   console.error('Principal account provisioning failed:',error.message);
   return res.status(503).json({error:'Principal account could not be created.'});
  }finally{c.release();}
 });
 app.get('/api/principal/overview',...principalOnly,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const days=Number(req.query?.days||7),departmentId=String(req.query?.departmentId||'');
  if(!ALLOWED_DAYS.has(days)||departmentId&&!UUID.test(departmentId))
   return res.status(400).json({error:'Choose a 7, 30 or 90-day window and a valid department.'});
  const schoolId=req.auth.schoolId,today=manilaToday();
  try{
   const departments=await pool.query(`SELECT department_id AS "departmentId",
      department_name AS "name" FROM school_departments
      WHERE school_id=$1 AND active=TRUE AND department_code<>'UNASSIGNED'
      ORDER BY department_name`,[schoolId]);
   if(departmentId&&!departments.rows.some(d=>d.departmentId===departmentId))
    return res.status(404).json({error:'Department is not active in this school.'});
   const scope=[schoolId,today,days,departmentId||null];
   const [roster,staff,activity,requests,locations,trend,byDepartment]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS active_students FROM students
      WHERE school_id=$1 AND active=TRUE`,[schoolId]),
    pool.query(`SELECT COUNT(*)::int AS active_teachers,
       COUNT(*) FILTER(WHERE department_id=$2::uuid)::int AS selected_department_teachers
       FROM school_users WHERE school_id=$1 AND active=TRUE AND role='TEACHER'`,
       [schoolId,departmentId||null]),
    pool.query(`SELECT
       COUNT(DISTINCT staff_user_id) FILTER(WHERE school_date=$2::date AND dtr_slot='AM_IN'
         AND verification_status='VERIFIED')::int AS today_verified_am_in,
       COUNT(*) FILTER(WHERE verification_status='VERIFIED')::int AS window_verified_slots,
       COUNT(*) FILTER(WHERE verification_status='PENDING_VERIFICATION')::int AS window_pending_slots,
       COUNT(DISTINCT staff_user_id) FILTER(WHERE verification_status='VERIFIED')::int AS window_staff_with_verified_slot
       FROM staff_attendance_events e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
       WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
         AND e.school_date BETWEEN ($2::date-($3::int-1)) AND $2::date
         AND u.role='TEACHER' AND ($4::uuid IS NULL OR u.department_id=$4::uuid)`,scope),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM staff_leave_requests l
        JOIN school_users u ON u.school_id=l.school_id AND u.user_id=l.staff_user_id
        WHERE l.school_id=$1 AND l.status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL')
          AND ($2::uuid IS NULL OR u.department_id=$2::uuid)) AS pending_leave,
      (SELECT COUNT(*)::int FROM staff_official_business_requests o
        JOIN school_users u ON u.school_id=o.school_id AND u.user_id=o.staff_user_id
        WHERE o.school_id=$1 AND o.status IN ('PENDING_HEAD','PENDING_ADMIN')
          AND ($2::uuid IS NULL OR u.department_id=$2::uuid)) AS pending_ob`,
       [schoolId,departmentId||null]),
    pool.query(`SELECT
      COUNT(*) FILTER(WHERE approved.setting_value IS NULL)::int AS unconfigured_departments,
      COUNT(*) FILTER(WHERE proposed.setting_value->>'status'='PENDING')::int AS pending_location_proposals
      FROM school_departments d
      LEFT JOIN school_settings approved ON approved.school_id=d.school_id
       AND approved.setting_key='staff_lunch_geo_'||d.department_id::text
      LEFT JOIN school_settings proposed ON proposed.school_id=d.school_id
       AND proposed.setting_key='staff_lunch_geo_proposal_'||d.department_id::text
      WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
       AND ($2::uuid IS NULL OR d.department_id=$2::uuid)`,
       [schoolId,departmentId||null]),
    pool.query(`WITH days AS (
      SELECT generate_series(($2::date-($3::int-1))::date,$2::date,interval '1 day')::date AS school_date
     ), counts AS (
       SELECT e.school_date,COUNT(DISTINCT e.staff_user_id) FILTER(
         WHERE e.dtr_slot='AM_IN' AND e.verification_status='VERIFIED')::int AS am_in,
         COUNT(*) FILTER(WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending
       FROM staff_attendance_events e JOIN school_users u
        ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
       WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
         AND e.school_date BETWEEN ($2::date-($3::int-1)) AND $2::date
         AND u.role='TEACHER' AND ($4::uuid IS NULL OR u.department_id=$4::uuid)
       GROUP BY e.school_date
     )
     SELECT to_char(days.school_date,'YYYY-MM-DD') AS "date",
       COALESCE(counts.am_in,0)::int AS "verifiedAmIn",
       COALESCE(counts.pending,0)::int AS pending
     FROM days LEFT JOIN counts ON counts.school_date=days.school_date
     ORDER BY days.school_date`,scope),
    pool.query(`WITH punches AS (
      SELECT u.department_id,COUNT(DISTINCT e.staff_user_id) FILTER(
        WHERE e.verification_status='VERIFIED' AND e.dtr_slot='AM_IN')::int AS verified_people,
        COUNT(*) FILTER(WHERE e.verification_status='PENDING_VERIFICATION')::int AS pending_count
      FROM staff_attendance_events e JOIN school_users u
        ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
      WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
        AND e.school_date BETWEEN ($2::date-($3::int-1)) AND $2::date
        AND u.role='TEACHER'
      GROUP BY u.department_id
     ), staff AS (
       SELECT department_id,COUNT(*)::int AS teachers FROM school_users
        WHERE school_id=$1 AND role='TEACHER' AND active=TRUE GROUP BY department_id
     )
     SELECT d.department_id AS "departmentId",d.department_name AS name,
       COALESCE(staff.teachers,0)::int AS teachers,
       COALESCE(punches.verified_people,0)::int AS "staffWithVerifiedAmIn",
       COALESCE(punches.pending_count,0)::int AS "pendingScans"
     FROM school_departments d LEFT JOIN staff ON staff.department_id=d.department_id
       LEFT JOIN punches ON punches.department_id=d.department_id
     WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
       AND ($4::uuid IS NULL OR d.department_id=$4::uuid)
     ORDER BY "pendingScans" DESC,name`,scope)
   ]);
   const allStaff=numeric(staff.rows[0],'active_teachers');
   const selectedStaff=departmentId?numeric(staff.rows[0],'selected_department_teachers'):allStaff;
   return res.json({
    source:'Attendigo school database',schoolDate:today,timezone:'Asia/Manila',
    generatedAt:new Date().toISOString(),days,departmentId:departmentId||null,
    metrics:{
     activeStudents:numeric(roster.rows[0],'active_students'),
     activeTeachers:selectedStaff,todayVerifiedAmIn:numeric(activity.rows[0],'today_verified_am_in'),
     windowVerifiedSlots:numeric(activity.rows[0],'window_verified_slots'),
     windowStaffWithVerifiedSlot:numeric(activity.rows[0],'window_staff_with_verified_slot'),
     windowPendingScans:numeric(activity.rows[0],'window_pending_slots'),
     pendingLeave:numeric(requests.rows[0],'pending_leave'),
     pendingOb:numeric(requests.rows[0],'pending_ob'),
     pendingLocationProposals:numeric(locations.rows[0],'pending_location_proposals'),
     unconfiguredDepartments:numeric(locations.rows[0],'unconfigured_departments')
    },
    departments:departments.rows,comparison:byDepartment.rows,trend:trend.rows,
    definitions:{
     todayVerifiedAmIn:'Distinct active or inactive teacher accounts with a verified AM Time-In DTR slot dated today; not an attendance or punctuality rate.',
     windowVerifiedSlots:'Count of verified teacher DTR slot entries during the selected date window, not distinct school days.',
     activeTeachers:'Current active Teacher accounts. Department grouping uses current assignment, not historical assignment.',
     activeStudents:'Active learner records across the school; no department-level student attribution is inferred.',
     pendingScans:'Teacher DTR entries awaiting verification; do not count as certified DTR punches.',
     trend:'Verified AM Time-In teacher counts by school date. Zero means no qualifying verified record, not proof of absence.'
    }
   });
  }catch(error){
   console.error('Principal leadership metrics unavailable:',error.message);
   return res.status(503).json({error:'Verified leadership metrics are temporarily unavailable. No figures have been estimated.'});
  }
 });
}
module.exports={registerPrincipalRoutes,manilaToday};
