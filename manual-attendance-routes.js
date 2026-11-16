'use strict';
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
        )`,[req.auth.schoolId,periodId,req.auth.userId,date]);
   return q.rows[0]||null;
 }
 app.get('/api/manual-attendance',...auth,async(req,res)=>{
   const {periodId,date}=req.query;
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date))return res.status(400).json({error:'Select a class and valid date.'});
   try {
     const period=await authorizedPeriod(pool,req,periodId,date);
     if(!period)return res.status(403).json({error:'This class is not assigned to you.'});
     const rows=await pool.query(`SELECT student_id AS "studentId",status,note,updated_at AS "updatedAt" FROM manual_attendance_marks WHERE school_id=$1 AND period_id=$2 AND school_date=$3`,[req.auth.schoolId,periodId,date]);
     return res.json({period,marks:rows.rows});
   }catch(err){console.error('Manual attendance read:',err.message);return res.status(500).json({error:'Unable to load manual attendance.'});}
 });
 app.post('/api/manual-attendance/sync',...auth,async(req,res)=>{
   const {periodId,date,marks}=req.body||{};
   if(!/^[0-9a-f-]{36}$/i.test(String(periodId||''))||!validDate(date)||!Array.isArray(marks)||marks.length>2000)return res.status(400).json({error:'Invalid attendance sheet.'});
   const seen=new Set();
   for(const m of marks){
     if(!m||typeof m.studentId!=='string'||m.studentId.length>160||!['PRESENT','LATE','ABSENT','EXCUSED'].includes(m.status)||typeof(m.note||'')!=='string'||(m.note||'').length>500||seen.has(m.studentId))return res.status(400).json({error:'Invalid or duplicate learner mark.'});
     seen.add(m.studentId);
   }
   const client=await pool.connect();
   try {
     await client.query('BEGIN');
     const period=await authorizedPeriod(client,req,periodId,date);
     if(!period){await client.query('ROLLBACK');return res.status(403).json({error:'This class is not assigned to you.'});}
     // Scope is checked in the database, including the active school-year enrollment.
     for(const m of marks){
       const r=await client.query(`SELECT 1 FROM students s
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
           AND COALESCE(active_enrollment.grade_level,s.grade_level)=$3 AND COALESCE(active_enrollment.section,s.section)=$4`,[req.auth.schoolId,m.studentId,period.grade_level,period.section]);
       if(!r.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'An attendance mark is outside this class roster.'});}
       await client.query(`INSERT INTO manual_attendance_marks(school_id,period_id,student_id,school_date,status,note,marked_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(school_id,period_id,student_id,school_date)
         DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,marked_by=EXCLUDED.marked_by,updated_at=NOW()`,[req.auth.schoolId,periodId,m.studentId,date,m.status,(m.note||'').trim(),req.auth.userId]);
     }
     await client.query('COMMIT');
     return res.json({saved:marks.length,date,periodId});
   }catch(err){await client.query('ROLLBACK').catch(()=>{});console.error('Manual attendance sync:',err.message);return res.status(500).json({error:'Unable to sync manual attendance.'});}
   finally{client.release();}
 });
}
module.exports={registerManualAttendanceRoutes};
