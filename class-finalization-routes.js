'use strict';
const {queueCloudOperation} = require('./cloud-mixed-operations');

// Teacher sign-off is per subject period, not an automatic full-day absence.
const { manilaToday } = require('./sardo-routes');
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(Date.parse(date+'T00:00:00Z'))
  && new Date(date+'T00:00:00Z').toISOString().slice(0,10) === date;

function registerClassFinalizationRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
  app.post('/api/manual-attendance/finalization',authenticateSchoolClient,requireSchoolRoles('TEACHER'),async(req,res)=>{
    const {periodId,date,action,operationId}=req.body||{};
    if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date)||!['FINALIZE','REOPEN'].includes(action))
      return res.status(400).json({error:'Select a valid class, date and finalization action.'});
    if(operationId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(operationId)))
      return res.status(400).json({error:'Invalid synchronization operation ID.'});
    const now=manilaToday();
    if(date>now)return res.status(400).json({error:'Future attendance cannot be finalized.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
        [req.auth.schoolId,periodId+'|'+date]);
      // The event ID doubles as a durable idempotency receipt for offline retries.
      // A repeated operation may acknowledge its original result, never toggle
      // the finalized state again. It must match school, actor and exact intent.
      if(operationId){
        const previous=await client.query(`SELECT school_id,period_id,school_date::text AS school_date,
          action,actor_user_id,roster_count FROM class_attendance_finalization_events WHERE event_id=$1`,
          [operationId]);
        if(previous.rowCount){
          const prior=previous.rows[0];
          if(String(prior.school_id)!==String(req.auth.schoolId)||String(prior.actor_user_id)!==String(req.auth.userId)||
             String(prior.period_id)!==String(periodId)||prior.school_date!==date||prior.action!==action){
            await client.query('ROLLBACK');
            return res.status(409).json({error:'Operation ID belongs to another request. Keep the local item for review.',code:'OPERATION_ID_CONFLICT'});
          }
          await client.query('COMMIT');
          return res.json({finalized:action==='FINALIZE',rosterCount:prior.roster_count,alreadySynced:true});
        }
      }
      const assigned=await client.query(`
        SELECT p.grade_level,p.section FROM class_periods p
        WHERE p.school_id=$1 AND p.period_id=$2 AND p.active=TRUE AND (
          EXISTS(SELECT 1 FROM teacher_period_assignments a WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)
          OR EXISTS(SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE' AND $4::date BETWEEN ts.start_date AND ts.end_date)
          OR EXISTS(SELECT 1 FROM schedule_day_adjustments da WHERE da.school_id=p.school_id AND da.period_id=p.period_id AND da.teacher_user_id=$3 AND da.school_date=$4::date)
          OR EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=p.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=p.grade_level AND ca.section=p.section)
        )`,[req.auth.schoolId,periodId,req.auth.userId,date]);
      if(!assigned.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'This class is not assigned to you.'});}
      const signed=await client.query('SELECT finalized,roster_count FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 FOR UPDATE',
        [req.auth.schoolId,periodId,date]);
      if(action==='REOPEN'){
        if(!signed.rows[0]?.finalized){await client.query('ROLLBACK');return res.status(409).json({error:'This register is not finalized.'});}
        await client.query('UPDATE class_attendance_finalizations SET finalized=FALSE,reopened_by_user_id=$4,reopened_at=NOW() WHERE school_id=$1 AND period_id=$2 AND school_date=$3',
          [req.auth.schoolId,periodId,date,req.auth.userId]);
        await client.query(`INSERT INTO class_attendance_finalization_events
          (school_id,period_id,school_date,action,actor_user_id,roster_count,event_id)
          VALUES($1,$2,$3,'REOPEN',$4,$5,COALESCE($6::uuid,gen_random_uuid()))`,
          [req.auth.schoolId,periodId,date,req.auth.userId,signed.rows[0].roster_count,operationId||null]);
        await queueCloudOperation(client,{
          schoolId:req.auth.schoolId,actorUserId:req.auth.userId,periodId,date,
          operationId:operationId||null,type:'REGISTER_SIGNOFF',action:'REOPEN',
          rosterCount:signed.rows[0].roster_count
        });
        await client.query('COMMIT');return res.json({finalized:false});
      }
      if(signed.rows[0]?.finalized){await client.query('ROLLBACK');return res.status(409).json({error:'This register is already finalized.'});}
      const closed=await client.query("SELECT 1 FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date AND exception_type='CLOSED'",[req.auth.schoolId,date]);
      if(closed.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This date is closed on the school calendar.'});}
      const period=assigned.rows[0];
      const summary=await client.query(`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE
            EXISTS(SELECT 1 FROM manual_attendance_marks m WHERE m.school_id=s.school_id
              AND m.student_id=s.student_id AND m.period_id=$2 AND m.school_date=$3::date)
            OR EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=s.school_id
              AND e.student_id=s.student_id AND e.period_id=$2 AND e.school_date=$3::date
              AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
              AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED')
          )::int AS completed
        FROM students s
        LEFT JOIN LATERAL (
          SELECT e.grade_level,e.section FROM student_enrollments e
          JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id
          WHERE e.school_id=s.school_id AND e.student_id=s.student_id
            AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED'
          ORDER BY e.created_at DESC LIMIT 1
        ) en ON TRUE
        WHERE s.school_id=$1 AND s.active=TRUE
          AND COALESCE(en.grade_level,s.grade_level)=$4
          AND COALESCE(en.section,s.section)=$5`,
        [req.auth.schoolId,periodId,date,period.grade_level,period.section]);
      const {total,completed}=summary.rows[0]||{};
      if(!total||total!==completed){
        await client.query('ROLLBACK');return res.status(409).json({
          error:`Finish syncing every learner's attendance first (${completed||0}/${total||0} confirmed). Missing entries are not absences.`});
      }
      const conflicts=await client.query(`SELECT 1 FROM manual_attendance_marks m
        WHERE m.school_id=$1 AND m.period_id=$2 AND m.school_date=$3::date
          AND m.status IN ('ABSENT','EXCUSED')
          AND EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=m.school_id
            AND e.period_id=m.period_id AND e.student_id=m.student_id
            AND e.school_date=m.school_date AND e.attendance_scope='CLASS'
            AND e.event_type='TIME_IN' AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED')
        LIMIT 1`,[req.auth.schoolId,periodId,date]);
      if(conflicts.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Resolve QR/manual attendance conflicts before finalizing.'});}
      await client.query(`INSERT INTO class_attendance_finalizations
          (school_id,period_id,school_date,finalized,roster_count,finalized_by_user_id,finalized_at,reopened_by_user_id,reopened_at)
          VALUES($1,$2,$3,TRUE,$4,$5,NOW(),NULL,NULL)
          ON CONFLICT(school_id,period_id,school_date) DO UPDATE SET finalized=TRUE,
          roster_count=EXCLUDED.roster_count,finalized_by_user_id=EXCLUDED.finalized_by_user_id,
          finalized_at=NOW(),reopened_by_user_id=NULL,reopened_at=NULL`,
        [req.auth.schoolId,periodId,date,total,req.auth.userId]);
      await client.query(`INSERT INTO class_attendance_finalization_events
          (school_id,period_id,school_date,action,actor_user_id,roster_count,event_id)
          VALUES($1,$2,$3,'FINALIZE',$4,$5,COALESCE($6::uuid,gen_random_uuid()))`,
        [req.auth.schoolId,periodId,date,req.auth.userId,total,operationId||null]);
      await queueCloudOperation(client,{
        schoolId:req.auth.schoolId,actorUserId:req.auth.userId,periodId,date,
        operationId:operationId||null,type:'REGISTER_SIGNOFF',action:'FINALIZE',rosterCount:total
      });
      await client.query('COMMIT');return res.json({finalized:true,rosterCount:total});
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      console.error('Class attendance finalization failed:',error.message);
      return res.status(500).json({error:'Unable to finalize attendance.'});
    }finally{client.release();}
  });
}
module.exports={registerClassFinalizationRoutes};
