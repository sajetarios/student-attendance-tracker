'use strict';
// Principal-only, school-scoped read-only leadership supplements.
// Each section is isolated: a missing optional table must not break the dashboard.
const {manilaDate}=require('./staff-lunch-routes');
function registerPrincipalWorkspaceRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 app.get('/api/principal/workspace',authenticateSchoolClient,
  requireSchoolRoles('PRINCIPAL','SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const schoolId=req.auth.schoolId,staffId=req.auth.userId;
   const day=String(req.query?.date||manilaDate());
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+'T00:00:00Z'))||
    new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day>manilaDate())
    return res.status(400).json({error:'Valid school date required.'});
   const queries={
    personalLeave:{
     sql:`SELECT request_id AS "requestId",leave_type AS "type",start_date AS "startDate",
      end_date AS "endDate",status,submitted_at AS "submittedAt"
      FROM staff_leave_requests WHERE school_id=$1 AND staff_user_id=$2
      ORDER BY submitted_at DESC LIMIT 15`,params:[schoolId,staffId]},
    personalOb:{
     sql:`SELECT request_id AS "requestId",purpose,starts_at AS "startsAt",
      ends_at AS "endsAt",status FROM staff_official_business_requests
      WHERE school_id=$1 AND staff_user_id=$2 ORDER BY submitted_at DESC LIMIT 15`,params:[schoolId,staffId]},
    leaveCredits:{
     sql:`SELECT credit_account AS "account",COALESCE(SUM(signed_days)
      FILTER(WHERE status='VERIFIED'),0) AS "balance"
      FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2
      GROUP BY credit_account ORDER BY credit_account`,params:[schoolId,staffId]},
    calendar:{
     sql:`SELECT to_char(calendar_date,'YYYY-MM-DD') AS date,exception_type AS type
      FROM school_calendar_exceptions WHERE school_id=$1
      AND calendar_date BETWEEN $2::date AND ($2::date+interval '45 days')
      ORDER BY calendar_date LIMIT 50`,params:[schoolId,day]},
    operatingDays:{
     sql:`SELECT weekday AS "dayOfWeek",is_operating_day AS "operating"
      FROM school_operating_days WHERE school_id=$1 ORDER BY weekday`,params:[schoolId]},
    gatekeeperAccounts:{
     sql:`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE active)::int AS active
      FROM school_users WHERE school_id=$1 AND role='GATE_KEEPER'`,params:[schoolId]},
    gateActivity:{
     sql:`SELECT COUNT(*)::int AS "verifiedMovements",
       COUNT(DISTINCT staff_user_id)::int AS "staffScanned"
      FROM staff_attendance_events WHERE school_id=$1 AND school_date=$2::date
      AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'`,params:[schoolId,day]},
    gatePending:{
     sql:`SELECT COUNT(*)::int AS "pendingEvents"
      FROM staff_attendance_events WHERE school_id=$1 AND school_date=$2::date
      AND verification_status='PENDING_VERIFICATION'`,params:[schoolId,day]}
   };
   const keys=Object.keys(queries),results=await Promise.allSettled(keys.map(k=>
    pool.query(queries[k].sql,queries[k].params)));
   const sections={};
   results.forEach((result,i)=>{
    const key=keys[i];
    if(result.status==='fulfilled')sections[key]={available:true,rows:result.value.rows};
    else {console.error('Principal workspace section '+key+':',result.reason?.message);
      sections[key]={available:false,rows:[],message:'Source temporarily unavailable'};}
   });
   return res.json({date:day,generatedAt:new Date().toISOString(),sections,
     notice:'Read-only sourced records. No approval, absence, lateness or certification inferred.'});
  });
}
module.exports={registerPrincipalWorkspaceRoutes};
