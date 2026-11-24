'use strict';
const {queueCloudOperation} = require('./cloud-mixed-operations');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T00:00:00Z'));
function registerManualAttendanceRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const auth=[authenticateSchoolClient,requireSchoolRoles('TEACHER')];
 async function authorizedPeriod(client,req,periodId,date) {
   const q=await client.query(`
      SELECT p.period_id,p.grade_level,p.section,p.subject_name,p.period_name
      FROM class_periods p WHERE p.school_id=$1 AND p.period_id=$2 AND p.active=TRUE
        AND (
          EXISTS(SELECT 1 FROM teacher_period_assignments a WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)
          OR EXISTS(SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE' AND $4::date BETWEEN ts.start_date AND ts.end_date)
          OR EXISTS(SELECT 1 FROM schedule_day_adjustments da WHERE da.school_id=p.school_id AND da.period_id=p.period_id AND da.teacher_user_id=$3 AND da.school_date=$4::date)
          OR EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=p.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=p.grade_level AND ca.section=p.section)
        )`,[req.auth.schoolId,periodId,req.auth.userId,date]);
   return q.rows[0]||null;
 }
 app.get('/api/manual-attendance',...auth,async(req,res)=>{
   const {periodId,date}=req.query;
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date))return res.status(400).json({error:'Select a class and valid date.'});
   try {
     const period=await authorizedPeriod(pool,req,periodId,date);
     if(!period)return res.status(403).json({error:'This class is not assigned to you.'});
     const rows=await pool.query(`SELECT student_id AS "studentId",status,note,revision::text AS "revision",updated_at AS "updatedAt" FROM manual_attendance_marks WHERE school_id=$1 AND period_id=$2 AND school_date=$3`,[req.auth.schoolId,periodId,date]);
     const finalization=await pool.query(`SELECT finalized,roster_count AS "rosterCount",finalized_at AS "finalizedAt"
         FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3`,
         [req.auth.schoolId,periodId,date]);
       const qr=await pool.query(`SELECT DISTINCT ON (e.student_id)
       e.student_id AS "studentId",CASE WHEN e.late THEN 'LATE' ELSE 'PRESENT' END AS status
       FROM attendance_events e
       WHERE e.school_id=$1 AND e.period_id=$2 AND e.school_date=$3
         AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED'
       ORDER BY e.student_id,e.occurred_at_device ASC,e.event_id ASC`,
       [req.auth.schoolId,periodId,date]);
       return res.json({period,marks:rows.rows,qrMarks:qr.rows,finalization:finalization.rows[0]||{finalized:false}});
   }catch(err){console.error('Manual attendance read:',err.message);return res.status(500).json({error:'Unable to load manual attendance.'});}
 });
 app.post('/api/manual-attendance/sync',...auth,async(req,res)=>{
   const {periodId,date,marks}=req.body||{};
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date)||!Array.isArray(marks)||marks.length>2000)return res.status(400).json({error:'Invalid attendance sheet.'});
   const seen=new Set();
   for(const m of marks){
     if(!m||typeof m.studentId!=='string'||m.studentId.length>160||!['PRESENT','LATE','ABSENT','EXCUSED'].includes(m.status)||typeof(m.note||'')!=='string'||(m.note||'').length>500||(m.expectedRevision!==undefined&&(!Number.isSafeInteger(m.expectedRevision)||m.expectedRevision<0))||seen.has(m.studentId))return res.status(400).json({error:'Invalid or duplicate learner mark.'});
     seen.add(m.studentId);
   }
   const client=await pool.connect();
   try {
     await client.query('BEGIN');
       await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
         [req.auth.schoolId,periodId+'|'+date]);
     const period=await authorizedPeriod(client,req,periodId,date);
     if(!period){await client.query('ROLLBACK');return res.status(403).json({error:'This class is not assigned to you.'});}
     const suspended=await client.query(`SELECT 1 FROM school_calendar_exceptions e
       JOIN class_periods p ON p.school_id=e.school_id AND p.period_id=$3
       LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id AND a.period_id=p.period_id AND a.school_date=e.calendar_date
       WHERE e.school_id=$1 AND e.calendar_date=$2::date
         AND (e.exception_type='CLOSED' OR (e.exception_type='CLASS_SUSPENSION'
          AND (e.suspension_time IS NULL OR COALESCE(a.end_time,p.end_time)>e.suspension_time)))`,
       [req.auth.schoolId,date,periodId]);
     if(suspended.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This class is suspended. Recorded learner attendance is preserved; do not enter new absences for the cancelled period.'});}
     const signed=await client.query('SELECT 1 FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 AND finalized=TRUE',[req.auth.schoolId,periodId,date]);
       if(signed.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This register is finalized. Reopen it before editing marks.'});}
       // Scope is checked in the database, including the active school-year enrollment.
     const changed=[];
     for(const m of marks){
       const r=await client.query(`SELECT 1 FROM students s
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
           AND COALESCE(active_enrollment.grade_level,s.grade_level)=$3 AND COALESCE(active_enrollment.section,s.section)=$4`,[req.auth.schoolId,m.studentId,period.grade_level,period.section]);
       if(!r.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Learner '+m.studentId+' is not active in this class roster. Refresh the roster or select the correct class before syncing.'});}
       // The class/date advisory lock serializes sheet edits and sign-offs. Compare
       // a per-learner revision as well, so another correction cannot be erased.
       const current=await client.query(`SELECT status,note,revision FROM manual_attendance_marks
         WHERE school_id=$1 AND period_id=$2 AND student_id=$3 AND school_date=$4 FOR UPDATE`,
         [req.auth.schoolId,periodId,m.studentId,date]);
       const prior=current.rows[0],note=(m.note||'').trim();
       if(prior&&prior.status===m.status&&prior.note===note)continue; // Safe retry.
       if(prior&&(!Number.isSafeInteger(m.expectedRevision) || String(m.expectedRevision)!==String(prior.revision))){
         await client.query('ROLLBACK');
         return res.status(409).json({error:'Attendance changed on the server for learner '+m.studentId+'. Reload the register and review your unsynced draft; no marks were overwritten.',studentId:m.studentId,code:'STALE_MANUAL_MARK'});
       }
       if(!prior&&m.expectedRevision!==undefined&&m.expectedRevision!==0){
         await client.query('ROLLBACK');
         return res.status(409).json({error:'Attendance was updated since your draft for learner '+m.studentId+'. Reload before retrying.',studentId:m.studentId,code:'STALE_MANUAL_MARK'});
       }
       const params=[req.auth.schoolId,periodId,m.studentId,date,m.status,note,req.auth.userId];
       const saved=prior
         ? await client.query(`UPDATE manual_attendance_marks SET status=$5,note=$6,marked_by=$7,
             updated_at=NOW(),revision=revision+1
             WHERE school_id=$1 AND period_id=$2 AND student_id=$3 AND school_date=$4
               AND revision=$8 RETURNING revision`,[...params,m.expectedRevision])
         : await client.query(`INSERT INTO manual_attendance_marks
             (school_id,period_id,student_id,school_date,status,note,marked_by,revision)
             VALUES($1,$2,$3,$4,$5,$6,$7,1)
             ON CONFLICT DO NOTHING RETURNING revision`,params);
       if(!saved.rowCount){
         await client.query('ROLLBACK');
         return res.status(409).json({error:'Another change was saved while this sheet was syncing. Refresh and review it before retrying.',studentId:m.studentId,code:'STALE_MANUAL_MARK'});
       }
       changed.push({studentId:m.studentId,status:m.status,note,
         expectedRevision:prior?Number(prior.revision):0,revision:Number(saved.rows[0].revision)});
     }
     // Enqueue the exact accepted local correction snapshot in this transaction.
     // If the cloud is unavailable, the queue persists without altering attendance.
     if(changed.length)await queueCloudOperation(client,{
       schoolId:req.auth.schoolId,actorUserId:req.auth.userId,periodId,date,
       type:'MANUAL_MARKS',marks:changed
     });
     await client.query('COMMIT');
     return res.json({saved:marks.length,date,periodId});
   }catch(err){await client.query('ROLLBACK').catch(()=>{});console.error('Manual attendance sync:',err.message);return res.status(500).json({error:'Unable to sync manual attendance.'});}
   finally{client.release();}
 });
 // Notes remain attached to the original date and class, and stay visible on later visits.
 app.get('/api/manual-attendance/notes',...auth,async(req,res)=>{
   const {periodId,date}=req.query;
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date))return res.status(400).json({error:'Select a class and date.'});
   try{
     const period=await authorizedPeriod(pool,req,periodId,date);
     if(!period)return res.status(403).json({error:'Class access denied.'});
     const items=await pool.query(`SELECT n.note_id AS "noteId",n.school_date::text AS date,n.body,
       n.created_at AS "createdAt",n.updated_at AS "updatedAt",n.archived_at AS "archivedAt"
       FROM manual_attendance_notes n WHERE n.school_id=$1 AND n.period_id=$2 AND n.author_id=$3
       ORDER BY n.school_date DESC,n.created_at DESC LIMIT 300`,[req.auth.schoolId,periodId,req.auth.userId]);
     return res.json({notes:items.rows});
   }catch(err){console.error('Teacher notes read failed:',err.message);return res.status(500).json({error:'Unable to load teacher notes.'})}
 });
 app.post('/api/manual-attendance/notes',...auth,async(req,res)=>{
   const {periodId,date,body}=req.body||{};
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date)||typeof body!=='string'||!body.trim()||body.trim().length>2000)return res.status(400).json({error:'A dated note is required (1–2000 characters).'});
   try{
     if(!await authorizedPeriod(pool,req,periodId,date))return res.status(403).json({error:'Class access denied.'});
     const result=await pool.query(`INSERT INTO manual_attendance_notes(school_id,period_id,school_date,author_id,body)
       VALUES($1,$2,$3,$4,$5) RETURNING note_id AS "noteId"`,[req.auth.schoolId,periodId,date,req.auth.userId,body.trim()]);
     return res.status(201).json(result.rows[0]);
   }catch(err){console.error('Teacher note save failed:',err.message);return res.status(500).json({error:'Unable to save teacher note.'})}
 });
 app.patch('/api/manual-attendance/notes/:noteId',...auth,async(req,res)=>{
   const noteId=String(req.params.noteId||'');
   if(!/^[0-9a-f-]{36}$/i.test(noteId))return res.status(400).json({error:'Invalid note ID.'});
   const {action,body}=req.body||{};
   if(!['edit','archive','restore','delete'].includes(action))return res.status(400).json({error:'Invalid note action.'});
   if(action==='edit'&&(typeof body!=='string'||!body.trim()||body.trim().length>2000))return res.status(400).json({error:'Note text is required.'});
   try{
     const q=await pool.query(`SELECT period_id AS "periodId", school_date::text AS date FROM manual_attendance_notes
       WHERE school_id=$1 AND author_id=$2 AND note_id=$3`,[req.auth.schoolId,req.auth.userId,noteId]);
     if(!q.rowCount)return res.status(404).json({error:'Note not found.'});
     if(!await authorizedPeriod(pool,req,q.rows[0].periodId,q.rows[0].date))return res.status(403).json({error:'Class access denied.'});
     if(action==='delete')await pool.query('DELETE FROM manual_attendance_notes WHERE school_id=$1 AND author_id=$2 AND note_id=$3',[req.auth.schoolId,req.auth.userId,noteId]);
     else if(action==='edit')await pool.query('UPDATE manual_attendance_notes SET body=$4, updated_at=NOW() WHERE school_id=$1 AND author_id=$2 AND note_id=$3',[req.auth.schoolId,req.auth.userId,noteId,body.trim()]);
     else await pool.query('UPDATE manual_attendance_notes SET archived_at='+ (action==='archive'?'NOW()':'NULL')+', updated_at=NOW() WHERE school_id=$1 AND author_id=$2 AND note_id=$3',[req.auth.schoolId,req.auth.userId,noteId]);
     return res.json({ok:true,action});
   }catch(err){console.error('Teacher note update failed:',err.message);return res.status(500).json({error:'Unable to update teacher note.'})}
 });
 app.get('/api/manual-attendance/history',...auth,async(req,res)=>{
   const {periodId,date}=req.query;
   const page=Math.max(0,Math.min(999,Number.parseInt(String(req.query.page||'0'),10)||0));
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date))return res.status(400).json({error:'Select a class and date.'});
   try{
     if(!await authorizedPeriod(pool,req,periodId,date))return res.status(403).json({error:'Class access denied.'});
     const params=[req.auth.schoolId,periodId];
     const total=await pool.query('SELECT count(*)::int AS total FROM manual_attendance_marks WHERE school_id=$1 AND period_id=$2',params);
     const rows=await pool.query(`SELECT m.student_id AS "studentId",s.full_name AS "fullName",
       m.school_date::text AS date,m.status,m.note,m.updated_at AS "updatedAt"
       FROM manual_attendance_marks m JOIN students s ON s.school_id=m.school_id AND s.student_id=m.student_id
       WHERE m.school_id=$1 AND m.period_id=$2 ORDER BY m.school_date DESC,s.full_name ASC
       LIMIT 10 OFFSET $3`,[...params,page*10]);
     return res.json({records:rows.rows,page,total:total.rows[0].total,pageSize:10});
   }catch(err){console.error('Manual attendance history failed:',err.message);return res.status(500).json({error:'Unable to load attendance history.'})}
 });


 // Authoritative conflict list: only an accepted QR class time-in for the same
 // learner, date and period contradicting an Absent/Excused manual mark.
 app.get('/api/manual-attendance/conflicts',...auth,async(req,res)=>{
   const {periodId}=req.query||{};
   const page=Math.max(0,Math.min(999,Number.parseInt(String(req.query.page||'0'),10)||0));
   const date=req.query.date||new Date().toISOString().slice(0,10);
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date))return res.status(400).json({error:'Choose an assigned class and valid date.'});
   try{
     if(!await authorizedPeriod(pool,req,periodId,date))return res.status(403).json({error:'You cannot review this class.'});
     const base=`FROM manual_attendance_marks m
       JOIN students s ON s.school_id=m.school_id AND s.student_id=m.student_id
       JOIN attendance_events e ON e.school_id=m.school_id
        AND e.student_id=m.student_id AND e.school_date=m.school_date AND e.period_id=m.period_id
        AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
        AND e.sync_status='ACCEPTED'
       WHERE m.school_id=$1 AND m.period_id=$2 AND m.status IN ('ABSENT','EXCUSED')`;
     const params=[req.auth.schoolId,periodId];
     const count=await pool.query('SELECT count(DISTINCT (m.student_id,m.school_date))::int AS total '+base,params);
     const rows=await pool.query(`SELECT DISTINCT ON (m.student_id,m.school_date)
       m.student_id AS "studentId",s.full_name AS "fullName",
       m.school_date::text AS date,m.status AS "manualStatus",m.note AS "manualNote",
       e.event_id AS "qrEventId",e.occurred_at_device AS "qrTime",
       e.late AS "qrLate",m.updated_at AS "manualUpdatedAt"
       ${base}
       ORDER BY m.student_id,m.school_date DESC,e.received_at_server DESC
       LIMIT 10 OFFSET $3`,[...params,page*10]);
     return res.json({records:rows.rows,page,total:count.rows[0].total,pageSize:10});
   }catch(error){console.error('Manual/QR conflicts read failed:',error.message);return res.status(500).json({error:'Could not load verified attendance conflicts.'});}
 });
 // Teachers can correct their class's manual mark. QR events remain immutable.
 app.post('/api/manual-attendance/conflicts/resolve',...auth,async(req,res)=>{
   const {periodId,studentId,date,status}=req.body||{};
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||typeof studentId!=='string'||!studentId||studentId.length>160||!validDate(date)||!['PRESENT','LATE'].includes(status))
     return res.status(400).json({error:'Select a verified conflict and a valid corrected status.'});
   const client=await pool.connect();
   try{
     await client.query('BEGIN');
     await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
       [req.auth.schoolId,periodId+'|'+date]);
     if(!await authorizedPeriod(client,req,periodId,date)){
       await client.query('ROLLBACK');return res.status(403).json({error:'This class is not assigned to you.'});
     }
     const signed=await client.query('SELECT 1 FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 AND finalized=TRUE',[req.auth.schoolId,periodId,date]);
       if(signed.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Reopen the finalized register before resolving attendance conflicts.'});}
       const result=await client.query(`UPDATE manual_attendance_marks m SET
       status=$5,marked_by=$6,updated_at=NOW(),revision=m.revision+1
       WHERE m.school_id=$1 AND m.period_id=$2 AND m.student_id=$3 AND m.school_date=$4
         AND m.status IN ('ABSENT','EXCUSED')
         AND EXISTS(SELECT 1 FROM attendance_events e
           WHERE e.school_id=m.school_id AND e.period_id=m.period_id
             AND e.student_id=m.student_id AND e.school_date=m.school_date
             AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
             AND e.sync_status='ACCEPTED')
       RETURNING m.student_id AS "studentId",m.status`,
       [req.auth.schoolId,periodId,studentId,date,status,req.auth.userId]);
     if(!result.rowCount){
       await client.query('ROLLBACK');return res.status(409).json({error:'The conflict changed or the QR record is no longer accepted. Refresh the conflict list.'});
     }
     await client.query('COMMIT');
     // The existing manual_attendance_audit trigger records the previous and new status.
     return res.json({resolved:true,record:result.rows[0]});
   }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Manual/QR conflict correction failed:',error.message);return res.status(500).json({error:'Could not correct the manual attendance mark.'});}
   finally{client.release();}
 });

}
module.exports={registerManualAttendanceRoutes};
