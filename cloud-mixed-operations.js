'use strict';
const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = new Set(['PRESENT','LATE','ABSENT','EXCUSED']);
const TYPES = new Set(['MANUAL_MARKS','REGISTER_SIGNOFF']);
const validDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && !Number.isNaN(Date.parse(day+'T00:00:00Z'))
  && new Date(day+'T00:00:00Z').toISOString().slice(0,10) === day;
class NeedsReview extends Error {
  constructor(code, message) { super(message); this.name='NeedsReview'; this.code=code; }
}
const review = (code, message) => { throw new NeedsReview(code, message); };

function validateOperation(op) {
  if (!op || !UUID.test(String(op.operationId||'')) || !TYPES.has(op.type) ||
      !validDate(op.date) || typeof op.actorUsername !== 'string' ||
      !op.actorUsername.trim() || op.actorUsername.length>80 ||
      !op.period || typeof op.period !== 'object') {
    review('INVALID_OPERATION','Invalid or incomplete synchronized attendance operation.');
  }
  const p=op.period;
  if (!['periodName','gradeLevel','section','subjectName','startTime','endTime'].every(k => typeof p[k]==='string') ||
      !p.periodName || !p.gradeLevel || !p.section ||
      !/^\d{2}:\d{2}$/.test(p.startTime) || !/^\d{2}:\d{2}$/.test(p.endTime)) {
    review('INVALID_PERIOD','The class identity is missing or invalid.');
  }
  if (op.type==='MANUAL_MARKS') {
    if (!Array.isArray(op.marks) || !op.marks.length || op.marks.length>2000)
      review('INVALID_MARKS','Provide a nonempty, bounded set of manual attendance corrections.');
    const seen=new Set();
    for(const m of op.marks){
      if(!m || typeof m.studentId!=='string' || !m.studentId || m.studentId.length>160 ||
         !STATUS.has(m.status) || typeof m.note!=='string' || m.note.length>500 ||
         !Number.isSafeInteger(m.expectedRevision) || m.expectedRevision<0 ||
         !Number.isSafeInteger(m.revision) || m.revision!==m.expectedRevision+1 ||
         seen.has(m.studentId))
        review('INVALID_MARKS','Invalid learner mark, revision, or duplicate ID.');
      seen.add(m.studentId);
    }
  } else if (!['FINALIZE','REOPEN'].includes(op.action) ||
             !Number.isSafeInteger(op.rosterCount) || op.rosterCount<0) {
    review('INVALID_SIGNOFF','Invalid register sign-off action or roster count.');
  }
}

async function queueCloudOperation(client, {schoolId,operationId,type,periodId,date,actorUserId,marks,action,rosterCount}) {
  if(!TYPES.has(type))throw new Error('Unsupported school cloud operation type.');
  const enabled=await client.query(
    'SELECT 1 FROM school_cloud_sync_settings WHERE school_id=$1 AND enabled=TRUE',[schoolId]);
  if(!enabled.rowCount)return false;
  const context=await client.query(
    `SELECT su.username, p.period_name, p.grade_level, p.section,
       COALESCE(p.subject_name,'') AS subject_name,
       to_char(p.start_time,'HH24:MI') AS start_time,
       to_char(p.end_time,'HH24:MI') AS end_time
     FROM school_users su JOIN class_periods p ON p.school_id=su.school_id
     WHERE su.school_id=$1 AND su.user_id=$2 AND p.period_id=$3 AND su.active=TRUE`,
    [schoolId,actorUserId,periodId]);
  if(!context.rowCount)throw new Error('Cannot queue cloud attendance without an active teacher and a class.');
  const p=context.rows[0];
  const payload={
    operationId: operationId||crypto.randomUUID(),type,date,actorUsername:p.username,
    period:{
      periodName:p.period_name,gradeLevel:p.grade_level,section:p.section||'',
      subjectName:p.subject_name||'',startTime:p.start_time,endTime:p.end_time
    },
    ...(type==='MANUAL_MARKS'?{marks}:{action,rosterCount})
  };
  validateOperation(payload);
  await client.query(
    `INSERT INTO school_cloud_sync_operations(school_id,operation_id,operation_type,payload)
     VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(school_id,operation_id) DO NOTHING`,
    [schoolId,payload.operationId,type,JSON.stringify(payload)]);
  return true;
}

async function resolveContext(client,schoolId,op) {
  const teacher=await client.query(
    `SELECT user_id FROM school_users WHERE school_id=$1 AND lower(username)=lower($2)
       AND role='TEACHER' AND active=TRUE`,[schoolId,op.actorUsername]);
  if(teacher.rowCount!==1)review('ACTOR_MAPPING','This teacher is not active or matched on the cloud school.');
  const p=op.period;
  const matched=await client.query(
    `SELECT period_id,grade_level,section FROM class_periods
      WHERE school_id=$1 AND active=TRUE AND period_name=$2 AND grade_level=$3
        AND section IS NOT DISTINCT FROM $4::text
        AND COALESCE(subject_name,'')=$5 AND start_time=$6::time AND end_time=$7::time
      LIMIT 2`,
    [schoolId,p.periodName,p.gradeLevel,p.section,p.subjectName,p.startTime,p.endTime]);
  if(matched.rowCount!==1)review('PERIOD_MAPPING','The exact class schedule is missing or ambiguous on the cloud school.');
  const period=matched.rows[0], userId=teacher.rows[0].user_id;
  const assigned=await client.query(
    `SELECT 1 FROM class_periods p
       WHERE p.school_id=$1 AND p.period_id=$2 AND p.active=TRUE AND (
         EXISTS(SELECT 1 FROM teacher_period_assignments a
           WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)
         OR EXISTS(SELECT 1 FROM teacher_period_substitutions ts
           WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
             AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE'
             AND $4::date BETWEEN ts.start_date AND ts.end_date)
         OR EXISTS(SELECT 1 FROM schedule_day_adjustments da
           WHERE da.school_id=p.school_id AND da.period_id=p.period_id
             AND da.teacher_user_id=$3 AND da.school_date=$4::date)
         OR EXISTS(SELECT 1 FROM class_adviser_assignments ca
           WHERE ca.school_id=p.school_id AND ca.adviser_user_id=$3
             AND ca.grade_level=p.grade_level AND ca.section=p.section)
       )`,[schoolId,period.period_id,userId,op.date]);
  if(!assigned.rowCount)review('TEACHER_ASSIGNMENT','The cloud school does not authorize this teacher for this class/date.');
  return {userId,periodId:period.period_id,grade:period.grade_level,section:period.section};
}
async function checkRoster(client,schoolId,periodId,day,grade,section) {
  const result=await client.query(`
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
      SELECT en.grade_level,en.section FROM student_enrollments en
      JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
      WHERE en.school_id=s.school_id AND en.student_id=s.student_id
        AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
      ORDER BY en.created_at DESC LIMIT 1
    ) en ON TRUE
    WHERE s.school_id=$1 AND s.active=TRUE
      AND COALESCE(en.grade_level,s.grade_level)=$4
      AND COALESCE(en.section,s.section)=$5`,
    [schoolId,periodId,day,grade,section]);
  return result.rows[0]||{total:0,completed:0};
}
async function applyMarks(client,schoolId,ctx,op) {
  const finalized=await client.query(
    'SELECT 1 FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 AND finalized=TRUE',
    [schoolId,ctx.periodId,op.date]);
  if(finalized.rowCount)review('FINALIZED_REGISTER','The cloud class register is finalized; reopen and review corrections.');
  for(const m of op.marks) {
    const enrolled=await client.query(`SELECT 1 FROM students s
      LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en
        JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
        WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE'
          AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) en ON TRUE
      WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
        AND COALESCE(en.grade_level,s.grade_level)=$3 AND COALESCE(en.section,s.section)=$4`,
      [schoolId,m.studentId,ctx.grade,ctx.section]);
    if(!enrolled.rowCount)review('LEARNER_MAPPING','Learner is not enrolled in the mapped cloud class: '+m.studentId);
    const prior=await client.query(
      `SELECT status,note,revision FROM manual_attendance_marks
       WHERE school_id=$1 AND period_id=$2 AND student_id=$3 AND school_date=$4 FOR UPDATE`,
      [schoolId,ctx.periodId,m.studentId,op.date]);
    const current=prior.rows[0];
    // A matching value is not sufficient evidence of a synchronized revision.
    // Only the exact next revision may be acknowledged without mutation;
    // any older/missing revision must be held for manual conflict review.
    if(current && current.status===m.status && current.note===m.note &&
       Number(current.revision)===m.revision) continue;
    if(current && String(current.revision)!==String(m.expectedRevision))
      review('STALE_CLOUD_MARK','Cloud attendance changed for learner '+m.studentId+'; no marks were overwritten.');
    if(!current && m.expectedRevision!==0)
      review('STALE_CLOUD_MARK','Cloud attendance is missing the prerequisite revision for learner '+m.studentId+'.');
    if(current) {
      const updated=await client.query(`UPDATE manual_attendance_marks SET
         status=$5,note=$6,marked_by=$7,revision=revision+1,updated_at=NOW()
         WHERE school_id=$1 AND period_id=$2 AND student_id=$3 AND school_date=$4
           AND revision=$8 RETURNING revision`,
        [schoolId,ctx.periodId,m.studentId,op.date,m.status,m.note,ctx.userId,m.expectedRevision]);
      if(!updated.rowCount)review('STALE_CLOUD_MARK','Cloud attendance changed during synchronization.');
    } else {
      const inserted=await client.query(`INSERT INTO manual_attendance_marks
        (school_id,period_id,student_id,school_date,status,note,marked_by,revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT DO NOTHING RETURNING revision`,
        [schoolId,ctx.periodId,m.studentId,op.date,m.status,m.note,ctx.userId]);
      if(!inserted.rowCount)review('STALE_CLOUD_MARK','Cloud attendance was created concurrently.');
    }
  }
}
async function applySignoff(client,schoolId,ctx,op) {
  const record=await client.query(
    'SELECT finalized,roster_count FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 FOR UPDATE',
    [schoolId,ctx.periodId,op.date]);
  if(op.action==='REOPEN') {
    if(!record.rows[0]?.finalized)
      review('REGISTER_STATE','Cloud register was already open or never finalized; review this sign-off.');
    if(Number(record.rows[0].roster_count)!==op.rosterCount)
      review('ROSTER_MISMATCH','Cloud register count differs from the local reopen request.');
    await client.query(`UPDATE class_attendance_finalizations SET finalized=FALSE,
      reopened_by_user_id=$4,reopened_at=NOW()
      WHERE school_id=$1 AND period_id=$2 AND school_date=$3`,
      [schoolId,ctx.periodId,op.date,ctx.userId]);
  } else {
    if(record.rows[0]?.finalized)
      review('REGISTER_STATE','Cloud register was already finalized under a different operation.');
    const closed=await client.query(
      "SELECT 1 FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date AND exception_type='CLOSED'",
      [schoolId,op.date]);
    if(closed.rowCount)review('CLOSED_SCHOOL_DAY','The cloud calendar marks this day closed.');
    const {total,completed}=await checkRoster(client,schoolId,ctx.periodId,op.date,ctx.grade,ctx.section);
    if(!total || total!==completed || total!==op.rosterCount)
      review('ROSTER_MISMATCH','Cloud classroom roster/attendance is incomplete or differs from the local register.');
    const conflict=await client.query(`SELECT 1 FROM manual_attendance_marks m WHERE
       m.school_id=$1 AND m.period_id=$2 AND m.school_date=$3::date AND m.status IN ('ABSENT','EXCUSED')
       AND EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=m.school_id
         AND e.period_id=m.period_id AND e.student_id=m.student_id AND e.school_date=m.school_date
         AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
         AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED') LIMIT 1`,
      [schoolId,ctx.periodId,op.date]);
    if(conflict.rowCount)review('QR_MANUAL_CONFLICT','Resolve accepted QR/manual conflicts before signing off on the cloud.');
    await client.query(`INSERT INTO class_attendance_finalizations
      (school_id,period_id,school_date,finalized,roster_count,finalized_by_user_id,finalized_at)
      VALUES($1,$2,$3,TRUE,$4,$5,NOW())
      ON CONFLICT(school_id,period_id,school_date) DO UPDATE SET
      finalized=TRUE,roster_count=EXCLUDED.roster_count,
      finalized_by_user_id=EXCLUDED.finalized_by_user_id,finalized_at=NOW(),
      reopened_by_user_id=NULL,reopened_at=NULL`,
      [schoolId,ctx.periodId,op.date,total,ctx.userId]);
  }
  const count=op.action==='REOPEN'?record.rows[0].roster_count:op.rosterCount;
  await client.query(`INSERT INTO class_attendance_finalization_events
    (event_id,school_id,period_id,school_date,action,actor_user_id,roster_count)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [op.operationId,schoolId,ctx.periodId,op.date,op.action,ctx.userId,count]);
}

async function receiveCloudOperation(client,schoolId,op) {
  validateOperation(op);
  const payloadHash=crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
  const existing=await client.query(`SELECT school_id,operation_type,payload_hash
    FROM cloud_sync_operation_receipts WHERE operation_id=$1`,[op.operationId]);
  if(existing.rowCount) {
    const e=existing.rows[0];
    if(String(e.school_id)!==String(schoolId) || e.operation_type!==op.type || e.payload_hash!==payloadHash)
      review('OPERATION_ID_CONFLICT','Operation ID belongs to a different school or payload.');
    return {operationId:op.operationId,status:'ALREADY_SYNCED'};
  }
  const ctx=await resolveContext(client,schoolId,op);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
    [schoolId,String(ctx.periodId)+'|'+op.date]);
  // Recheck after acquiring the class/day lock: a concurrent request may
  // have applied this exact operation while this request was waiting.
  const afterLock=await client.query(`SELECT school_id,operation_type,payload_hash
    FROM cloud_sync_operation_receipts WHERE operation_id=$1`,[op.operationId]);
  if(afterLock.rowCount){
    const applied=afterLock.rows[0];
    if(String(applied.school_id)!==String(schoolId)||
       applied.operation_type!==op.type||applied.payload_hash!==payloadHash)
      review('OPERATION_ID_CONFLICT','Operation ID belongs to a different school or payload.');
    return {operationId:op.operationId,status:'ALREADY_SYNCED'};
  }
  if(op.type==='MANUAL_MARKS') await applyMarks(client,schoolId,ctx,op);
  else await applySignoff(client,schoolId,ctx,op);
  await client.query(`INSERT INTO cloud_sync_operation_receipts
    (school_id,operation_id,operation_type,payload_hash) VALUES($1,$2,$3,$4)`,
    [schoolId,op.operationId,op.type,payloadHash]);
  return {operationId:op.operationId,status:'ACCEPTED'};
}

module.exports={queueCloudOperation,receiveCloudOperation,NeedsReview,validateOperation};
