'use strict';
const {manilaDate}=require('./staff-lunch-routes');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LIMIT=151; // One extra row reveals truncation; never pretend a partial list is complete.

function registerPrincipalClassImpactRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 app.get('/api/principal/class-impact',
  authenticateSchoolClient,requireSchoolRoles('PRINCIPAL','SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const departmentId=req.query?.departmentId?String(req.query.departmentId):null;
   if(departmentId&&!UUID.test(departmentId))
    return res.status(400).json({error:'Select a valid school department.'});
   const today=manilaDate(); // Seven calendar dates beginning with the Philippine school date.
   const through=new Date(Date.parse(today+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
   const params=[req.auth.schoolId,today,departmentId];
   try{
    if(departmentId){
     const permitted=await pool.query(
      'SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE LIMIT 1',
      [req.auth.schoolId,departmentId]);
     if(!permitted.rowCount)return res.status(404).json({error:'Department is not active in this school.'});
    }
    // These two queries intentionally use different sources. Approved OB already
    // has explicit NEEDS_COVERAGE entries. Approved leave requires checking the
    // effective timetable because leave never creates an OB coverage record.
    // Routine applications, personal reasons and diagnoses are NOT returned.
    const [ob,leave]=await Promise.all([
     pool.query(`
      SELECT DISTINCT 'OB'::text AS "kind",
        to_char(c.class_date,'YYYY-MM-DD') AS "date",
        p.period_id AS "periodId",
        p.period_name AS "periodName",p.grade_level AS "gradeLevel",p.section,
        to_char(p.start_time,'HH24:MI') AS "startTime",
        to_char(p.end_time,'HH24:MI') AS "endTime",
        COALESCE(o.department_id,p.department_id) AS "departmentId",
        COALESCE(d.department_name,'Unassigned / unavailable department') AS "departmentName"
      FROM staff_ob_class_coverage c
      JOIN staff_official_business_requests o ON o.school_id=c.school_id
        AND o.request_id=c.request_id AND o.status='APPROVED'
      JOIN class_periods p ON p.school_id=c.school_id AND p.period_id=c.period_id
      LEFT JOIN school_departments d ON d.school_id=c.school_id
        AND d.department_id=COALESCE(o.department_id,p.department_id)
      WHERE c.school_id=$1 AND c.status='NEEDS_COVERAGE'
        AND c.class_date BETWEEN $2::date AND $2::date+6
        AND ($3::uuid IS NULL OR COALESCE(o.department_id,p.department_id)=$3::uuid)
        AND p.active=TRUE
        AND (p.effective_from IS NULL OR p.effective_from<=c.class_date)
        AND (p.effective_to IS NULL OR p.effective_to>=c.class_date)
        AND EXISTS(SELECT 1 FROM class_period_days w WHERE w.school_id=p.school_id
          AND w.period_id=p.period_id AND w.weekday=EXTRACT(DOW FROM c.class_date)::int)
        AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
          AND ce.calendar_date=c.class_date AND ce.exception_type='CLOSED')
        AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
          AND ce.calendar_date=c.class_date AND ce.exception_type='SHORTENED_DAY'
          AND ce.dismissal_time IS NOT NULL AND p.start_time>=ce.dismissal_time)
        AND (NOT EXISTS(SELECT 1 FROM school_operating_days op WHERE op.school_id=p.school_id
          AND op.weekday=EXTRACT(DOW FROM c.class_date)::int AND op.is_operating_day=FALSE)
          OR EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
           AND ce.calendar_date=c.class_date
           AND ce.exception_type IN ('OPEN','SPECIAL_CLASS','SHORTENED_DAY')))
        AND NOT EXISTS(SELECT 1 FROM schedule_day_adjustments a WHERE a.school_id=p.school_id
          AND a.period_id=p.period_id AND a.school_date=c.class_date
          AND (a.adjustment_type='CANCEL' OR
            (a.teacher_user_id IS NOT NULL AND a.teacher_user_id<>o.staff_user_id
             AND EXISTS(SELECT 1 FROM school_users su WHERE su.school_id=a.school_id
              AND su.user_id=a.teacher_user_id AND su.active=TRUE))))
        AND NOT EXISTS(SELECT 1 FROM teacher_period_substitutions ts
          JOIN school_users su ON su.school_id=ts.school_id
           AND su.user_id=ts.substitute_teacher_user_id AND su.active=TRUE
          WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
            AND ts.original_teacher_user_id=o.staff_user_id AND ts.status='ACTIVE'
            AND c.class_date BETWEEN ts.start_date AND ts.end_date)
      ORDER BY "date","startTime","departmentName"
      LIMIT ${LIMIT}`,params),
     pool.query(`
      SELECT DISTINCT 'LEAVE'::text AS "kind",
        to_char(days.class_date,'YYYY-MM-DD') AS "date",
        p.period_id AS "periodId",
        p.period_name AS "periodName",p.grade_level AS "gradeLevel",p.section,
        to_char(p.start_time,'HH24:MI') AS "startTime",
        to_char(p.end_time,'HH24:MI') AS "endTime",
        COALESCE(u.department_id,p.department_id) AS "departmentId",
        COALESCE(d.department_name,'Unassigned / unavailable department') AS "departmentName"
      FROM staff_form48_approved_leaves l
      JOIN school_users u ON u.school_id=l.school_id AND u.user_id=l.staff_user_id
        AND u.active=TRUE
      JOIN teacher_period_assignments ta ON ta.school_id=l.school_id
        AND ta.teacher_user_id=l.staff_user_id
      JOIN class_periods p ON p.school_id=ta.school_id AND p.period_id=ta.period_id
      JOIN LATERAL generate_series(
         GREATEST(l.start_date,$2::date),LEAST(l.end_date,$2::date+6),
         interval '1 day') AS days(class_date) ON TRUE
      LEFT JOIN school_departments d ON d.school_id=p.school_id
       AND d.department_id=COALESCE(u.department_id,p.department_id)
      WHERE l.school_id=$1 AND l.revoked_at IS NULL
        AND l.start_date<=$2::date+6 AND l.end_date>=$2::date
        AND ($3::uuid IS NULL OR COALESCE(u.department_id,p.department_id)=$3::uuid)
        AND p.active=TRUE
        AND (p.effective_from IS NULL OR p.effective_from<=days.class_date::date)
        AND (p.effective_to IS NULL OR p.effective_to>=days.class_date::date)
        AND EXISTS(SELECT 1 FROM class_period_days w WHERE w.school_id=p.school_id
          AND w.period_id=p.period_id AND w.weekday=EXTRACT(DOW FROM days.class_date)::int)
        AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
          AND ce.calendar_date=days.class_date::date AND ce.exception_type='CLOSED')
        AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
          AND ce.calendar_date=days.class_date::date AND ce.exception_type='SHORTENED_DAY'
          AND ce.dismissal_time IS NOT NULL AND p.start_time>=ce.dismissal_time)
        AND (NOT EXISTS(SELECT 1 FROM school_operating_days op WHERE op.school_id=p.school_id
          AND op.weekday=EXTRACT(DOW FROM days.class_date)::int AND op.is_operating_day=FALSE)
          OR EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id
           AND ce.calendar_date=days.class_date::date
           AND ce.exception_type IN ('OPEN','SPECIAL_CLASS','SHORTENED_DAY')))
        AND NOT EXISTS(SELECT 1 FROM schedule_day_adjustments a WHERE a.school_id=p.school_id
          AND a.period_id=p.period_id AND a.school_date=days.class_date::date
          AND (a.adjustment_type='CANCEL' OR
            (a.teacher_user_id IS NOT NULL AND a.teacher_user_id<>l.staff_user_id
             AND EXISTS(SELECT 1 FROM school_users su WHERE su.school_id=a.school_id
              AND su.user_id=a.teacher_user_id AND su.active=TRUE))))
        AND NOT EXISTS(SELECT 1 FROM teacher_period_substitutions ts
          JOIN school_users su ON su.school_id=ts.school_id
           AND su.user_id=ts.substitute_teacher_user_id AND su.active=TRUE
          WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
            AND ts.original_teacher_user_id=l.staff_user_id AND ts.status='ACTIVE'
            AND days.class_date::date BETWEEN ts.start_date AND ts.end_date)
        AND NOT EXISTS(SELECT 1 FROM staff_ob_class_coverage c
          JOIN staff_official_business_requests ob ON ob.school_id=c.school_id
           AND ob.request_id=c.request_id AND ob.staff_user_id=l.staff_user_id
          WHERE c.school_id=p.school_id AND c.period_id=p.period_id
           AND c.class_date=days.class_date::date AND c.status='SUBSTITUTE_ASSIGNED'
           AND ob.status='APPROVED')
      ORDER BY "date","startTime","departmentName"
      LIMIT ${LIMIT}`,params)
    ]);
    const all=[...ob.rows,...leave.rows].sort((a,b)=>
      a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime)||
      a.departmentName.localeCompare(b.departmentName));
    const limited=ob.rows.length>=LIMIT||leave.rows.length>=LIMIT||all.length>150;
    const cases=all.slice(0,150);
    res.json({fromDate:today,throughDate:through,departmentId,
     unresolvedCount:limited?null:all.length,atLeast:limited?cases.length:null,limited,
     cases,notice:'Only approved leave/OB periods without recorded substitute or valid schedule adjustment are flagged. Departmental coverage documented in the timetable is suppressed. Not evidence of absence or an approval decision.'});
   }catch(e){
    console.error('Principal class continuity read failed:',e.message);
    res.status(503).json({error:'Cannot verify instructional coverage right now. No zero-count or estimated coverage result was generated.'});
   }
  });
}
module.exports={registerPrincipalClassImpactRoutes};
