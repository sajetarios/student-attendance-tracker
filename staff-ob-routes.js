'use strict';
const {randomUUID}=require('node:crypto');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const roles=['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'];
function registerStaffObRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const auth=[authenticateSchoolClient,requireSchoolRoles(...roles)];
 const respondError=(res,e)=>{console.error('Staff OB request error:',e.message);return res.status(503).json({error:'Official Business service unavailable.'});};
 const audit=(client,req,action,id,details)=>client.query(
  `INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
   VALUES($1,$2,$3,'STAFF_OFFICIAL_BUSINESS',$4,$5::jsonb)`,
  [req.auth.schoolId,req.auth.userId,action,id,JSON.stringify(details)]);
 const scoped=(req)=>req.auth.role==='SCHOOL_ADMIN'?'':req.auth.role==='DEPARTMENT_HEAD'?' AND o.department_id=$2':' AND o.staff_user_id=$2';
 const params=(req)=>req.auth.role==='SCHOOL_ADMIN'?[req.auth.schoolId]:[req.auth.schoolId,req.auth.role==='DEPARTMENT_HEAD'?req.auth.departmentId:req.auth.userId];
 app.get('/api/staff-attendance/official-business',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(req.auth.role==='DEPARTMENT_HEAD'&&!req.auth.departmentId)return res.status(403).json({error:'Department assignment required.'});
  try{
   const result=await pool.query(`SELECT o.request_id AS "requestId",o.staff_user_id AS "staffUserId",
    u.display_name AS "staffName",o.department_id AS "departmentId",
    o.purpose,o.destination,o.starts_at AS "startsAt",o.ends_at AS "endsAt",
    o.status,o.submitted_at AS "submittedAt",o.decision_note AS "decisionNote",
    o.head_decided_at AS "headDecidedAt",o.admin_decided_at AS "adminDecidedAt"
    FROM staff_official_business_requests o
    JOIN school_users u ON u.school_id=o.school_id AND u.user_id=o.staff_user_id
    WHERE o.school_id=$1${scoped(req)}
    ORDER BY o.submitted_at DESC LIMIT 100`,params(req));
   return res.json({requests:result.rows});
  }catch(e){return respondError(res,e);}
 });
 app.get('/api/staff-attendance/official-business/:id/coverage',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(!uuid.test(req.params.id))return res.status(400).json({error:'Valid OB request required.'});
  if(req.auth.role==='DEPARTMENT_HEAD'&&!req.auth.departmentId)
   return res.status(403).json({error:'Department assignment required.'});
  try{
   const result=await pool.query(`
    SELECT c.coverage_id AS "coverageId",c.class_date AS "classDate",
     c.period_id AS "periodId",p.period_name AS "periodName",
     p.grade_level AS "gradeLevel",p.section,
     p.start_time AS "startTime",p.end_time AS "endTime",
     c.status,c.substitute_user_id AS "substituteUserId",
     su.display_name AS "substituteName"
    FROM staff_ob_class_coverage c
    JOIN staff_official_business_requests o ON o.school_id=c.school_id
     AND o.request_id=c.request_id
    JOIN class_periods p ON p.school_id=c.school_id AND p.period_id=c.period_id
    LEFT JOIN school_users su ON su.school_id=c.school_id AND su.user_id=c.substitute_user_id
    WHERE c.school_id=$1 AND c.request_id=$2
      AND ($3='SCHOOL_ADMIN' OR ($3='DEPARTMENT_HEAD' AND o.department_id=$4)
        OR ($3='TEACHER' AND o.staff_user_id=$5))
    ORDER BY c.class_date,p.start_time LIMIT 300`,
    [req.auth.schoolId,req.params.id,req.auth.role,req.auth.departmentId||null,req.auth.userId]);
   return res.json({coverage:result.rows});
  }catch(e){return respondError(res,e);}
 });
 app.post('/api/staff-attendance/official-business/:id/coverage/:coverageId/substitute',
  authenticateSchoolClient,requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const substituteId=String(req.body?.substituteUserId||'');
   if(!uuid.test(req.params.id)||!uuid.test(req.params.coverageId)||!uuid.test(substituteId)||
      !req.auth.departmentId)return res.status(400).json({error:'Valid OB, coverage, substitute and department required.'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    // School-wide transaction lock serializes simultaneous substitute allocations.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[String(req.auth.schoolId)+':OB_COVERAGE']);
    const coverage=await client.query(`
      SELECT c.coverage_id,c.period_id,c.class_date,p.start_time,p.end_time,
       o.staff_user_id,o.department_id
      FROM staff_ob_class_coverage c
      JOIN staff_official_business_requests o ON o.school_id=c.school_id AND o.request_id=c.request_id
      JOIN class_periods p ON p.school_id=c.school_id AND p.period_id=c.period_id
      WHERE c.school_id=$1 AND c.request_id=$2 AND c.coverage_id=$3
       AND o.department_id=$4 AND o.status='APPROVED' AND c.status='NEEDS_COVERAGE'
      FOR UPDATE OF c`,[req.auth.schoolId,req.params.id,req.params.coverageId,req.auth.departmentId]);
    if(!coverage.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Approved, uncovered class in your department required.'});}
    const target=coverage.rows[0];
    if(substituteId===target.staff_user_id||substituteId===req.auth.userId){
     await client.query('ROLLBACK');return res.status(409).json({error:'Choose another eligible teacher, not yourself or the absent teacher.'});
    }
    const eligible=await client.query(`SELECT user_id FROM school_users
      WHERE school_id=$1 AND user_id=$2 AND department_id=$3
       AND role='TEACHER' AND active=TRUE`,
      [req.auth.schoolId,substituteId,req.auth.departmentId]);
    if(!eligible.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Substitute must be an active teacher in your department.'});}
    // Reject overlapping recurring teaching assignments, current substitutions,
    // date-specific teacher changes, and already allocated OB coverage.
    const conflict=await client.query(`
      SELECT 1 FROM class_periods p
      WHERE p.school_id=$1 AND p.period_id<>$4 AND p.active=TRUE
       AND (p.effective_from IS NULL OR p.effective_from<=$3::date)
       AND (p.effective_to IS NULL OR p.effective_to>=$3::date)
       AND p.start_time<$6::time AND p.end_time>$5::time
       AND EXISTS(SELECT 1 FROM class_period_days w WHERE w.school_id=p.school_id
        AND w.period_id=p.period_id AND w.weekday=EXTRACT(DOW FROM $3::date)::int)
       AND (
        EXISTS(SELECT 1 FROM teacher_period_assignments ta WHERE ta.school_id=p.school_id
          AND ta.period_id=p.period_id AND ta.teacher_user_id=$2)
        OR EXISTS(SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=p.school_id
          AND ts.period_id=p.period_id AND ts.substitute_teacher_user_id=$2
          AND ts.status='ACTIVE' AND $3::date BETWEEN ts.start_date AND ts.end_date)
        OR EXISTS(SELECT 1 FROM schedule_day_adjustments a WHERE a.school_id=p.school_id
          AND a.period_id=p.period_id AND a.school_date=$3::date
          AND a.teacher_user_id=$2 AND a.adjustment_type<>'CANCEL')
       )
      UNION ALL
      SELECT 1 FROM staff_ob_class_coverage c
      WHERE c.school_id=$1 AND c.class_date=$3::date AND c.period_id<>$4
       AND c.status='SUBSTITUTE_ASSIGNED' AND c.substitute_user_id=$2
       AND EXISTS(SELECT 1 FROM class_periods p WHERE p.school_id=c.school_id
        AND p.period_id=c.period_id AND p.start_time<$6::time AND p.end_time>$5::time)
      LIMIT 1`,
      [req.auth.schoolId,substituteId,target.class_date,target.period_id,
       target.start_time,target.end_time]);
    if(conflict.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Substitute has a conflicting class or coverage assignment at this time.'});}
    await client.query(`UPDATE staff_ob_class_coverage
       SET status='SUBSTITUTE_ASSIGNED',substitute_user_id=$4,
        assigned_by_user_id=$5,assigned_at=NOW()
       WHERE school_id=$1 AND request_id=$2 AND coverage_id=$3`,
      [req.auth.schoolId,req.params.id,req.params.coverageId,substituteId,req.auth.userId]);
    await audit(client,req,'STAFF_OB_SUBSTITUTE_ASSIGNED',req.params.id,
      {coverageId:req.params.coverageId,substituteUserId:substituteId});
    await client.query('COMMIT');
    return res.json({coverageId:req.params.coverageId,status:'SUBSTITUTE_ASSIGNED'});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});return respondError(res,e);}
   finally{client.release();}
  });
 app.post('/api/staff-attendance/official-business',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const purpose=String(req.body?.purpose||'').trim(),destination=String(req.body?.destination||'').trim();
  const start=new Date(req.body?.startsAt),end=new Date(req.body?.endsAt);
  if(purpose.length<3||purpose.length>1000||destination.length<2||destination.length>300||
    !Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||
    end.getTime()-start.getTime()>14*86400000||start.getTime()<Date.now()-86400000)
   return res.status(400).json({error:'Valid purpose, destination and OB start/end (up to 14 days) required.'});
  if(!req.auth.departmentId)return res.status(403).json({error:'A school department must be assigned before requesting OB.'});
  const id=randomUUID(),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query(`INSERT INTO staff_official_business_requests
    (request_id,school_id,staff_user_id,department_id,purpose,destination,starts_at,ends_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id,req.auth.schoolId,req.auth.userId,req.auth.departmentId,purpose,destination,start,end]);
   await audit(client,req,'STAFF_OB_SUBMITTED',id,{departmentId:req.auth.departmentId,startsAt:start.toISOString(),endsAt:end.toISOString()});
   await client.query('COMMIT');
   return res.status(201).json({requestId:id,status:'PENDING_HEAD'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return respondError(res,e);}
  finally{client.release();}
 });
 app.post('/api/staff-attendance/official-business/:id/recommend',authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   if(!uuid.test(req.params.id)||!req.auth.departmentId)return res.status(400).json({error:'Valid request and department required.'});
   const recommendation=String(req.body?.decision||'').toUpperCase(),note=String(req.body?.note||'').trim();
   if(!['RECOMMEND','REJECT'].includes(recommendation)||note.length>1000)
    return res.status(400).json({error:'Choose RECOMMEND or REJECT with a note up to 1000 characters.'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const result=await client.query(`UPDATE staff_official_business_requests o
      SET status=$5,head_user_id=$4,head_decided_at=NOW(),decision_note=$6
      WHERE o.school_id=$1 AND o.request_id=$2 AND o.department_id=$3
       AND o.status='PENDING_HEAD' AND o.staff_user_id<>$4
      RETURNING request_id,status`,
      [req.auth.schoolId,req.params.id,req.auth.departmentId,req.auth.userId,
       recommendation==='RECOMMEND'?'PENDING_ADMIN':'REJECTED',note||null]);
    if(!result.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Request unavailable, already reviewed, outside your department, or self-review prohibited.'});}
    await audit(client,req,recommendation==='RECOMMEND'?'STAFF_OB_RECOMMENDED':'STAFF_OB_HEAD_REJECTED',req.params.id,{note});
    await client.query('COMMIT');
    return res.json({requestId:req.params.id,status:result.rows[0].status});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});return respondError(res,e);}
   finally{client.release();}
  });
 app.post('/api/staff-attendance/official-business/:id/decide',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const decision=String(req.body?.decision||'').toUpperCase(),note=String(req.body?.note||'').trim();
   if(!uuid.test(req.params.id)||!['APPROVE','REJECT'].includes(decision)||note.length>1000)
    return res.status(400).json({error:'Valid request, APPROVE/REJECT decision and note required.'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const result=await client.query(`UPDATE staff_official_business_requests
      SET status=$4,admin_user_id=$3,admin_decided_at=NOW(),decision_note=$5
      WHERE school_id=$1 AND request_id=$2 AND status='PENDING_ADMIN'
       AND staff_user_id<>$3 RETURNING request_id,status,staff_user_id,starts_at,ends_at`,
      [req.auth.schoolId,req.params.id,req.auth.userId,
       decision==='APPROVE'?'APPROVED':'REJECTED',note||null]);
    if(!result.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Request not awaiting School Admin decision or self-approval prohibited.'});}
    // Flag each affected class date without modifying the recurring timetable.
    // Only the assigned regular teacher's active, weekday-matching periods are
    // included; actual lesson-time overlap is checked in Asia/Manila.
    if(decision==='APPROVE'){
      const affected=await client.query(`
       INSERT INTO staff_ob_class_coverage
        (school_id,request_id,period_id,class_date,status)
       SELECT $1,$2,p.period_id,days.class_date,'NEEDS_COVERAGE'
       FROM staff_official_business_requests ob
       JOIN LATERAL generate_series(
        (ob.starts_at AT TIME ZONE 'Asia/Manila')::date,
        (ob.ends_at AT TIME ZONE 'Asia/Manila')::date,
        interval '1 day') AS days(class_date) ON TRUE
       JOIN class_periods p ON p.school_id=ob.school_id AND p.active=TRUE
        AND (p.effective_from IS NULL OR p.effective_from<=days.class_date)
        AND (p.effective_to IS NULL OR p.effective_to>=days.class_date)
       JOIN teacher_period_assignments ta ON ta.school_id=p.school_id
        AND ta.period_id=p.period_id AND ta.teacher_user_id=ob.staff_user_id
       JOIN class_period_days w ON w.school_id=p.school_id
        AND w.period_id=p.period_id
        AND w.weekday=EXTRACT(DOW FROM days.class_date)::int
       WHERE ob.school_id=$1 AND ob.request_id=$2
        AND (days.class_date::date+p.start_time) AT TIME ZONE 'Asia/Manila'<ob.ends_at
        AND (days.class_date::date+p.end_time) AT TIME ZONE 'Asia/Manila'>ob.starts_at
       ON CONFLICT(school_id,request_id,period_id,class_date) DO NOTHING
       RETURNING coverage_id`,[req.auth.schoolId,req.params.id]);
      await audit(client,req,'STAFF_OB_AFFECTED_CLASSES_FLAGGED',req.params.id,
        {affectedClasses:affected.rowCount});
    }
    await audit(client,req,decision==='APPROVE'?'STAFF_OB_APPROVED':'STAFF_OB_ADMIN_REJECTED',req.params.id,{note});
    await client.query('COMMIT');
    return res.json({requestId:req.params.id,status:result.rows[0].status});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});return respondError(res,e);}
   finally{client.release();}
  });
}
module.exports={registerStaffObRoutes};
