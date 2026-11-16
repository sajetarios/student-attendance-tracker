// Student portal provisioning and teacher approval requests.
// One student account per existing school-scoped learner. Passwords are returned once.
'use strict';
const crypto = require('node:crypto');
const { hashPassword } = require('./auth-security');

function problem(status, message) { const err = new Error(message); err.status = status; return err; }
const enrollmentJoin = [
 "LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en",
 "JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id",
 "WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE'",
 "AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) e ON TRUE"
].join(' ');

// Deliberately matches the teacher roster rule, including active substitutions.
const teacherScope = [
 "(",
 "EXISTS (SELECT 1 FROM teacher_period_assignments a JOIN class_periods p",
 "ON p.school_id=a.school_id AND p.period_id=a.period_id AND p.active=TRUE",
 "WHERE a.school_id=s.school_id AND a.teacher_user_id=$2",
 "AND p.grade_level=COALESCE(e.grade_level,s.grade_level)",
 "AND (p.section IS NULL OR p.section=COALESCE(e.section,s.section)))",
 "OR EXISTS (SELECT 1 FROM class_adviser_assignments ca",
 "WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$2",
 "AND ca.grade_level=COALESCE(e.grade_level,s.grade_level)",
 "AND ca.section=COALESCE(e.section,s.section))",
 "OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts JOIN class_periods sp",
 "ON sp.school_id=ts.school_id AND sp.period_id=ts.period_id AND sp.active=TRUE",
 "WHERE ts.school_id=s.school_id AND ts.substitute_teacher_user_id=$2",
 "AND ts.status='ACTIVE' AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date",
 "AND sp.grade_level=COALESCE(e.grade_level,s.grade_level)",
 "AND (sp.section IS NULL OR sp.section=COALESCE(e.section,s.section)))",
 ")"
].join(' ');

function toStudent(row, admin) {
 return { studentId:row.student_id, fullName:row.full_name, gradeLevel:row.grade_level,
   section:row.section, hasAccount:Boolean(row.student_account_id),
   accountActive:Boolean(row.account_active),
   username: admin ? (row.username || null) : null,
   mustChangePassword:admin ? Boolean(row.must_change_password) : undefined };
}
async function findStudents(db, auth, studentId) {
 const teacher = auth.role === 'TEACHER';
 const params = [auth.schoolId];
 if (teacher) params.push(auth.userId);
 const filters = ['s.school_id=$1', 's.active=TRUE', 's.archived_at IS NULL'];
 if (teacher) filters.push(teacherScope);
 if (studentId !== undefined) {
   params.push(studentId);
   filters.push('s.student_id=$' + params.length);
 }
 const sql = [
  'SELECT s.student_id,s.full_name,COALESCE(e.grade_level,s.grade_level) AS grade_level,',
  'COALESCE(e.section,s.section) AS section, sa.student_account_id,sa.username,',
  'sa.active AS account_active,sa.must_change_password',
  'FROM students s', enrollmentJoin,
  'LEFT JOIN student_accounts sa ON sa.school_id=s.school_id AND sa.student_id=s.student_id',
  'WHERE ' + filters.join(' AND '), 'ORDER BY s.full_name LIMIT 5000'
 ].join(' ');
 const found = await db.query(sql, params);
 return found.rows.map(row => toStudent(row, auth.role === 'SCHOOL_ADMIN'));
}
async function logAudit(db, auth, action, entityType, entityId, details) {
 await db.query(
  "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,$3,$4,$5,$6::jsonb)",
  [auth.schoolId,auth.userId,action,entityType,String(entityId),JSON.stringify(details || {})]
 );
}
async function transaction(pool, fn) {
 const db = await pool.connect();
 try { await db.query('BEGIN'); const value = await fn(db); await db.query('COMMIT'); return value; }
 catch(err){ await db.query('ROLLBACK').catch(()=>{}); throw err; }
 finally{db.release();}
}
async function provision(db, auth, studentId, action) {
 const student = await db.query(
  'SELECT student_id,full_name FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE AND archived_at IS NULL FOR UPDATE',
  [auth.schoolId, studentId]
 );
 if (!student.rowCount) throw problem(404, 'The active learner record was not found.');
 const existing = await db.query(
  'SELECT student_account_id,username,active FROM student_accounts WHERE school_id=$1 AND student_id=$2 FOR UPDATE',
  [auth.schoolId, studentId]
 );
 if (action === 'CREATE' && existing.rowCount) throw problem(409, 'The learner already has a student portal account.');
 if (action === 'RESET' && (!existing.rowCount || !existing.rows[0].active)) throw problem(409, 'Only an active login can be reset.');
 if (action === 'ACTIVATE' && (!existing.rowCount || existing.rows[0].active)) throw problem(409, 'Only a disabled existing login can be reactivated.');
 const password = 'At-' + crypto.randomBytes(24).toString('base64url') + '-7!';
 const hash = await hashPassword(password);
 let result;
 if (action === 'CREATE') {
   result = await db.query(
    'INSERT INTO student_accounts(school_id,student_id,username,password_hash,must_change_password) VALUES($1,$2,$3,$4,TRUE) RETURNING student_account_id,username',
    [auth.schoolId,studentId,studentId,hash]
   );
 } else {
   result = await db.query(
    'UPDATE student_accounts SET password_hash=$3,active=TRUE,must_change_password=TRUE,failed_login_attempts=0,locked_until=NULL,updated_at=NOW() WHERE school_id=$1 AND student_id=$2 RETURNING student_account_id,username',
    [auth.schoolId,studentId,hash]
   );
   await db.query(
    'UPDATE student_sessions SET revoked_at=NOW() WHERE school_id=$1 AND student_account_id=$2 AND revoked_at IS NULL',
    [auth.schoolId,result.rows[0].student_account_id]
   );
 }
 const { student_account_id, username } = result.rows[0];
 await logAudit(db,auth,'SCHOOL_ADMIN_' + action + '_STUDENT_PORTAL_LOGIN','student_account',student_account_id,{studentId,username});
 return {studentId,fullName:student.rows[0].full_name,username,temporaryPassword:password,mustChangePassword:true};
}
function handleError(res,err,description) {
 if (err.status) return res.status(err.status).json({error:err.message});
 if (err.code==='23505') return res.status(409).json({error:'An account, username, or pending request already exists.'});
 console.error(description,err.message);
 return res.status(500).json({error:'Could not complete the student portal account operation.'});
}
function registerStudentPortalAccountRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const admin = [authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const permitted = [authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN','TEACHER')];
 const teacher = [authenticateSchoolClient,requireSchoolRoles('TEACHER')];

 app.get('/api/student-portal/accounts',...permitted,async(req,res)=>{
  try{
   const students = await findStudents(pool,req.auth);
   return res.json({students,counts:{
    total:students.length, active:students.filter(s=>s.accountActive).length,
    disabled:students.filter(s=>s.hasAccount && !s.accountActive).length,
    withoutAccount:students.filter(s=>!s.hasAccount).length
   }});
  }catch(err){return handleError(res,err,'Student portal directory failed:');}
 });

 app.get('/api/student-portal/requests',...permitted,async(req,res)=>{
  try{
   const teacherOnly=req.auth.role==='TEACHER';
   const params=[req.auth.schoolId];
   const where=['r.school_id=$1'];
   if(teacherOnly){params.push(req.auth.userId);where.push('r.requested_by_user_id=$2');}
   const rows=await pool.query([
    'SELECT r.request_id,r.student_id,r.request_type,r.reason,r.status,',
    'r.review_note,r.created_at,r.reviewed_at,s.full_name,',
    'u.display_name AS requested_by_name',
    'FROM student_account_requests r',
    'JOIN students s ON s.school_id=r.school_id AND s.student_id=r.student_id',
    'JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.requested_by_user_id',
    'WHERE '+where.join(' AND '),'ORDER BY r.created_at DESC LIMIT 150'
   ].join(' '),params);
   res.json({requests:rows.rows.map(r=>({
    requestId:r.request_id,studentId:r.student_id,fullName:r.full_name,
    requestType:r.request_type,reason:r.reason,status:r.status,
    requestedBy:r.requested_by_name,createdAt:r.created_at,reviewedAt:r.reviewed_at,reviewNote:r.review_note
   }))});
  }catch(err){return handleError(res,err,'Student portal requests list failed:');}
 });

 app.post('/api/student-portal/requests',...teacher,async(req,res)=>{
  const studentId=String(req.body?.studentId||'').trim();
  const reason=String(req.body?.reason||'').trim();
  const requestType=String(req.body?.requestType||'CREATE').toUpperCase();
  if(!studentId || studentId.length>80 || !['CREATE','RESET','ACTIVATE'].includes(requestType) || reason.length<8 || reason.length>500)
   return res.status(400).json({error:'Choose a learner, request type, and a reason of 8 to 500 characters.'});
  try{
   const result=await transaction(pool,async db=>{
    const students=await findStudents(db,req.auth,studentId);
    if(!students.length) throw problem(403,'This learner is not in your assigned subjects or advisory section.');
    const current=students[0];
    if(requestType==='CREATE' && current.hasAccount)throw problem(409,'This learner already has a login.');
    if(requestType==='RESET' && !current.accountActive)throw problem(409,'This learner has no active login to reset.');
    if(requestType==='ACTIVATE' && (!current.hasAccount || current.accountActive))throw problem(409,'This learner does not have a disabled login.');
    const inserted=await db.query(
     'INSERT INTO student_account_requests(school_id,student_id,requested_by_user_id,request_type,reason) VALUES($1,$2,$3,$4,$5) RETURNING request_id',
     [req.auth.schoolId,studentId,req.auth.userId,requestType,reason]
    );
    await logAudit(db,req.auth,'TEACHER_REQUEST_STUDENT_PORTAL_LOGIN','student_account_request',inserted.rows[0].request_id,{studentId,requestType});
    return inserted.rows[0].request_id;
   });
   return res.status(201).json({requestId:result,status:'PENDING'});
  }catch(err){return handleError(res,err,'Student portal request failed:');}
 });

 app.post('/api/student-portal/requests/:requestId/review',...admin,async(req,res)=>{
  const requestId=String(req.params.requestId||'');
  const decision=String(req.body?.decision||'').toUpperCase();
  const note=String(req.body?.note||'').trim();
  if(!/^[a-f0-9-]{36}$/i.test(requestId)||!['APPROVE','REJECT'].includes(decision)||note.length>500)
   return res.status(400).json({error:'Supply a valid request decision and optional review note.'});
  try{
   const outcome=await transaction(pool,async db=>{
    const records=await db.query(
     'SELECT request_id,student_id,request_type,status FROM student_account_requests WHERE school_id=$1 AND request_id=$2 FOR UPDATE',
     [req.auth.schoolId,requestId]
    );
    if(!records.rowCount)throw problem(404,'Request not found.');
    const item=records.rows[0];
    if(item.status!=='PENDING')throw problem(409,'This request has already been reviewed.');
    const credentials=decision==='APPROVE' ? await provision(db,req.auth,item.student_id,item.request_type) : null;
    const newStatus=decision==='APPROVE'?'APPROVED':'REJECTED';
    await db.query(
     'UPDATE student_account_requests SET status=$3,review_note=$4,reviewed_by_user_id=$5,reviewed_at=NOW() WHERE school_id=$1 AND request_id=$2',
     [req.auth.schoolId,requestId,newStatus,note||null,req.auth.userId]
    );
    await logAudit(db,req.auth,'SCHOOL_ADMIN_REVIEW_STUDENT_PORTAL_REQUEST','student_account_request',requestId,{studentId:item.student_id,decision:newStatus});
    return {status:newStatus,credentials};
   });
   return res.json(outcome);
  }catch(err){return handleError(res,err,'Student portal review failed:');}
 });

 app.post('/api/student-portal/accounts/:studentId/provision',...admin,async(req,res)=>{
  const studentId=String(req.params.studentId||'').trim();
  const action=String(req.body?.action||'CREATE').toUpperCase();
  if(!studentId||studentId.length>80||!['CREATE','RESET','ACTIVATE'].includes(action))
   return res.status(400).json({error:'Choose an existing learner and valid account action.'});
  try{
   const credentials=await transaction(pool,db=>provision(db,req.auth,studentId,action));
   return res.status(action==='CREATE'?201:200).json({credentials});
  }catch(err){return handleError(res,err,'Student portal provisioning failed:');}
 });

 app.post('/api/student-portal/accounts/bulk-provision',...admin,async(req,res)=>{
  const ids=req.body?.studentIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>20 || ids.some(id=>typeof id!=='string'||!id.trim()||id.length>80) || new Set(ids).size!==ids.length)
   return res.status(400).json({error:'Select 1 to 20 distinct existing learners.'});
  try{
   const credentials=await transaction(pool,async db=>{
    const output=[];
    for(const id of ids)output.push(await provision(db,req.auth,id,'CREATE'));
    return output;
   });
   return res.status(201).json({credentials});
  }catch(err){return handleError(res,err,'Student portal batch provisioning failed:');}
 });

 app.patch('/api/student-portal/accounts/:studentId/status',...admin,async(req,res)=>{
  const studentId=String(req.params.studentId||'').trim();
  if(!studentId||studentId.length>80||typeof req.body?.active!=='boolean')
   return res.status(400).json({error:'Choose a learner and active status.'});
  if(req.body.active){
   try{const credentials=await transaction(pool,db=>provision(db,req.auth,studentId,'ACTIVATE'));return res.json({active:true,credentials});}
   catch(err){return handleError(res,err,'Student portal activation failed:');}
  }
  try{
   const result=await transaction(pool,async db=>{
    const existing=await db.query(
     'UPDATE student_accounts SET active=FALSE,updated_at=NOW() WHERE school_id=$1 AND student_id=$2 AND active=TRUE RETURNING student_account_id',
     [req.auth.schoolId,studentId]
    );
    if(!existing.rowCount)throw problem(404,'No active student portal login was found.');
    await db.query(
     'UPDATE student_sessions SET revoked_at=NOW() WHERE school_id=$1 AND student_account_id=$2 AND revoked_at IS NULL',
     [req.auth.schoolId,existing.rows[0].student_account_id]
    );
    await logAudit(db,req.auth,'SCHOOL_ADMIN_SUSPEND_STUDENT_PORTAL_LOGIN','student_account',existing.rows[0].student_account_id,{studentId});
    return {active:false};
   });
   return res.json(result);
  }catch(err){return handleError(res,err,'Student portal suspension failed:');}
 });
}
module.exports={registerStudentPortalAccountRoutes};
