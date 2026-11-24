'use strict';
const {resolveSubjectStatus}=require('./parent-subject-status');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const manilaDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const manilaMinutes=()=>{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const get=x=>Number(parts.find(p=>p.type===x)?.value||0);
 return get('hour')*60+get('minute');
};
function registerParentSubjectRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const guards=[authenticateSchoolClient,requireSchoolRoles('PARENT')];

 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 app.get('/api/parent/subject-notifications/settings',...admin,async(req,res)=>{
  try{
   const r=await pool.query("SELECT setting_value FROM school_settings WHERE school_id=$1 AND setting_key='parent_subject_notifications'",[req.auth.schoolId]);
   res.set('Cache-Control','private, no-store').json({enabled:r.rows[0]?.setting_value===true});
  }catch(error){console.error('Subject notification setting:',error.message);res.status(503).json({error:'Could not load parent notification settings.'});}
 });
 app.put('/api/parent/subject-notifications/settings',...admin,async(req,res)=>{
  if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Choose whether notifications are enabled.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query(`INSERT INTO school_settings(school_id,setting_key,setting_value,updated_at)
     VALUES($1,'parent_subject_notifications',$2::jsonb,NOW())
     ON CONFLICT(school_id,setting_key)
     DO UPDATE SET setting_value=$2::jsonb,updated_at=NOW()`,
     [req.auth.schoolId,JSON.stringify(req.body.enabled)]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'PARENT_SUBJECT_NOTIFICATIONS_CONFIGURED','school_settings',
       'parent_subject_notifications',$3::jsonb)`,
     [req.auth.schoolId,req.auth.userId,JSON.stringify({enabled:req.body.enabled})]);
   await client.query('COMMIT');
   res.set('Cache-Control','no-store').json({enabled:req.body.enabled});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Subject notification setting change:',error.message);
   res.status(503).json({error:'Could not save parent notification settings.'});
  }finally{client.release();}
 });

 app.get('/api/parent/children/:studentId/subjects',...guards,async(req,res)=>{
  const studentId=String(req.params.studentId||'');
  const today=manilaDate();
  const date=req.query.date?String(req.query.date):today;
  if(!validDate(date)||studentId.length>160)return res.status(400).json({error:'Select a valid school date and learner.'});
  try{
   // Authorization is checked in the database, not inferred from a client-supplied child name.
   const linked=await pool.query(`SELECT s.full_name AS "studentName"
     FROM parent_student_links l JOIN students s ON s.school_id=l.school_id AND s.student_id=l.student_id
     WHERE l.school_id=$1 AND l.parent_user_id=$2 AND l.student_id=$3
       AND l.status='APPROVED' AND s.active=TRUE`,
     [req.auth.schoolId,req.auth.userId,studentId]);
   if(!linked.rowCount)return res.status(404).json({error:'No approved link to this learner.'});
   const [periods,gate]=await Promise.all([
    pool.query(`
      SELECT p.period_id AS "periodId", p.period_name AS "periodName",
        COALESCE(NULLIF(btrim(p.subject_name),''),p.period_name) AS "subjectName",
        COALESCE(a.start_time,p.start_time)::text AS "startTime",
        COALESCE(a.end_time,p.end_time)::text AS "endTime",
        COALESCE(a.adjustment_type,'') AS "adjustmentType",
        EXISTS(SELECT 1 FROM school_calendar_exceptions x WHERE x.school_id=p.school_id
           AND x.calendar_date=$4::date AND x.exception_type='CLOSED') AS closed,
        EXISTS(SELECT 1 FROM class_attendance_finalizations f
           WHERE f.school_id=p.school_id AND f.period_id=p.period_id AND f.school_date=$4::date
             AND f.finalized=TRUE) AS finalized,
        m.status AS "manualStatus",m.updated_at AS "manualRecordedAt",
        CASE WHEN qr.has_qr THEN (CASE WHEN qr.has_late THEN 'LATE' ELSE 'PRESENT' END) END AS "qrStatus",
        qr.recorded_at AS "qrRecordedAt"
      FROM students s
      LEFT JOIN LATERAL (
        SELECT e.grade_level,e.section FROM student_enrollments e
        JOIN school_years y ON y.school_id=e.school_id AND y.school_year_id=e.school_year_id
        WHERE e.school_id=s.school_id AND e.student_id=s.student_id
          AND y.status='ACTIVE' AND e.enrollment_status='ENROLLED'
        ORDER BY e.created_at DESC LIMIT 1
      ) enrollment ON TRUE
      JOIN class_periods p ON p.school_id=s.school_id AND p.active=TRUE
        AND p.grade_level=COALESCE(enrollment.grade_level,s.grade_level)
        AND p.section=COALESCE(enrollment.section,s.section)
        AND COALESCE(p.schedule_type,'CLASS')='CLASS'
      LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id
        AND a.period_id=p.period_id AND a.school_date=$4::date
      LEFT JOIN manual_attendance_marks m ON m.school_id=p.school_id AND m.period_id=p.period_id
        AND m.student_id=s.student_id AND m.school_date=$4::date
      LEFT JOIN LATERAL (
        SELECT COUNT(*)>0 AS has_qr,COALESCE(bool_or(e.late),FALSE) AS has_late,
          MIN(e.occurred_at_device) AS recorded_at
        FROM attendance_events e
        WHERE e.school_id=p.school_id AND e.period_id=p.period_id AND e.student_id=s.student_id
          AND e.school_date=$4::date AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
          AND e.sync_status='ACCEPTED'
      ) qr ON TRUE
      WHERE s.school_id=$1 AND s.student_id=$3 AND s.active=TRUE
        AND (p.effective_from IS NULL OR p.effective_from<=$4::date)
        AND (p.effective_to IS NULL OR p.effective_to>=$4::date)
        AND (
          EXISTS(SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id
            AND d.weekday=EXTRACT(DOW FROM $4::date)::int)
          OR a.adjustment_type IS NOT NULL OR m.student_id IS NOT NULL OR qr.has_qr
          OR EXISTS(SELECT 1 FROM class_attendance_finalizations f
            WHERE f.school_id=p.school_id AND f.period_id=p.period_id AND f.school_date=$4::date)
        )
      ORDER BY COALESCE(a.start_time,p.start_time),p.period_name,p.period_id`,
      [req.auth.schoolId,req.auth.userId,studentId,date]),
    pool.query(`SELECT event_type AS "eventType",occurred_at_device AS "occurredAt"
      FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND school_date=$3::date
        AND attendance_scope='SCHOOL' AND sync_status='ACCEPTED'
        ORDER BY occurred_at_device,event_id`,[req.auth.schoolId,studentId,date])
   ]);
   const records=periods.rows.map(row=>{
    const status=resolveSubjectStatus({...row,schoolDate:date},{today,nowMinutes:manilaMinutes()});
    return {periodId:row.periodId,periodName:row.periodName,subjectName:row.subjectName,
      startTime:row.startTime,endTime:row.endTime,status,finalized:row.finalized,
      source:row.qrStatus&&row.manualStatus?'QR_AND_MANUAL':row.qrStatus?'CLASS_QR':row.manualStatus?'MANUAL':null,
      recordedAt:row.qrRecordedAt||row.manualRecordedAt||null};
   });
   const firstArrival=gate.rows.find(r=>r.eventType==='TIME_IN');
   const exits=gate.rows.filter(r=>r.eventType==='TIME_OUT');
   res.set('Cache-Control','private, no-store').json({
    studentId,studentName:linked.rows[0].studentName,date,
    gate:{arrival:firstArrival?.occurredAt||null,departure:exits.at(-1)?.occurredAt||null},
    subjects:records
   });
  }catch(error){
   console.error('Parent subject attendance:',error.message);
   return res.status(503).json({error:'Subject attendance is temporarily unavailable.'});
  }
 });
}
module.exports={registerParentSubjectRoutes,validDate};
