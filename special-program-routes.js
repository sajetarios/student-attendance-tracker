'use strict';
const {registerSpecialProgramBatchRoutes}=require('./special-program-batch-routes');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=id=>typeof id==='string'&&UUID.test(id);
const clean=v=>typeof v==='string'?v.trim():'';
const activeYearSql="SELECT e.enrollment_id,e.student_id,e.school_year_id,e.grade_level,e.section,e.enrollment_status,e.enrollment_date,sy.status AS year_status,sy.end_date FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id WHERE e.school_id=$1 AND e.enrollment_id=$2 AND s.active=TRUE FOR UPDATE OF e";
const mineSql="SELECT e.enrollment_id AS \"enrollmentId\",e.student_id AS \"studentId\",e.grade_level AS \"gradeLevel\",e.section,sy.school_year_label AS \"schoolYear\",p.program_code AS \"programCode\",p.program_name AS \"programName\" FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id AND sy.status='ACTIVE' LEFT JOIN student_special_programs sp ON sp.school_id=e.school_id AND sp.enrollment_id=e.enrollment_id AND sp.is_primary=TRUE AND sp.status='ACTIVE' LEFT JOIN special_program_types p ON p.school_id=sp.school_id AND p.program_type_id=sp.program_type_id WHERE e.school_id=$1 AND e.enrollment_status='ENROLLED'";
function registerSpecialProgramRoutes(app,pool,auth){
 const {authenticateSchoolClient,requireSchoolRoles}=auth;
 const admin=requireSchoolRoles('SCHOOL_ADMIN'),staff=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
 const mayRequest=u=>u.role==='DEPARTMENT_HEAD'||(u.role==='TEACHER'&&u.teacherDesignations?.includes('CLASS_ADVISER'));
 const publicError=err=>['23505','23514','22P02','INVALID_YEAR','INVALID_PROGRAM','UNCHANGED'].includes(err.code);
 const errorReply=(res,err)=>res.status(err.code==='23505'||err.code==='INVALID_YEAR'||err.code==='UNCHANGED'?409:publicError(err)?400:500).json({error:err.code==='23505'?'A pending request or assignment already exists.':publicError(err)?err.message:'Unable to complete program operation.'});
 async function getEnrollment(c,school,id){return (await c.query(activeYearSql,[school,id])).rows[0]||null;}
 async function permitted(c,u,e){
  if(u.role==='TEACHER'&&u.teacherDesignations?.includes('CLASS_ADVISER')){
   const r=await c.query('SELECT EXISTS(SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4) AS ok',[u.schoolId,u.userId,e.grade_level,e.section]);
   return r.rows[0]?.ok===true;
  }
  if(u.role==='DEPARTMENT_HEAD'&&validId(u.departmentId)&&u.departmentCode!=='UNASSIGNED'){
   const r=await c.query("SELECT (EXISTS(SELECT 1 FROM class_periods p WHERE p.school_id=$1 AND p.department_id=$2 AND p.active=TRUE AND p.grade_level=$3 AND p.section=$4) OR EXISTS(SELECT 1 FROM class_adviser_assignments ca JOIN school_users a ON a.school_id=ca.school_id AND a.user_id=ca.adviser_user_id AND a.role='TEACHER' AND a.active=TRUE AND a.department_id=$2 WHERE ca.school_id=$1 AND ca.grade_level=$3 AND ca.section=$4)) AS ok",[u.schoolId,u.departmentId,e.grade_level,e.section]);
   return r.rows[0]?.ok===true;
  }
  return false;
 }
 function invalid(message,code){return Object.assign(new Error(message),{code});}
 async function change(c,u,e,action,programTypeId){
  if(e.year_status!=='ACTIVE'||e.enrollment_status!=='ENROLLED')throw invalid('Enrollment and school year must be active.','INVALID_YEAR');
  if(action==='ASSIGN'){
   const result=await c.query('SELECT 1 FROM special_program_types WHERE school_id=$1 AND program_type_id=$2 AND active=TRUE',[u.schoolId,programTypeId]);
   if(!result.rowCount)throw invalid('Program not found in your school.','INVALID_PROGRAM');
  }
  const previous=await c.query("SELECT student_program_id,program_type_id FROM student_special_programs WHERE school_id=$1 AND enrollment_id=$2 AND status='ACTIVE' AND is_primary=TRUE FOR UPDATE",[u.schoolId,e.enrollment_id]);
  if(action==='REMOVE'&&!previous.rowCount)throw invalid('No active primary program to remove.','UNCHANGED');
  if(action==='ASSIGN'&&previous.rows.some(r=>String(r.program_type_id)===String(programTypeId)))throw invalid('Student already belongs to that program.','UNCHANGED');
  await c.query("UPDATE student_special_programs SET status='COMPLETED',is_primary=FALSE,updated_at=NOW() WHERE school_id=$1 AND student_id=$2 AND school_year_id=$3 AND is_primary=TRUE AND status='ACTIVE'",[u.schoolId,e.student_id,e.school_year_id]);
  if(action==='ASSIGN')await c.query("INSERT INTO student_special_programs(school_id,student_id,school_year_id,enrollment_id,program_type_id,is_primary,start_date,assigned_by_user_id) VALUES($1,$2,$3,$4,$5,TRUE,GREATEST($6::date,LEAST((NOW() AT TIME ZONE 'Asia/Manila')::date,$7::date)),$8)",[u.schoolId,e.student_id,e.school_year_id,e.enrollment_id,programTypeId,e.enrollment_date,e.end_date,u.userId]);
  await c.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,$3,'student',$4,$5::jsonb)",[u.schoolId,u.userId,'SPECIAL_PROGRAM_'+action,e.student_id,JSON.stringify({enrollmentId:e.enrollment_id,programTypeId:action==='ASSIGN'?programTypeId:null,previous:previous.rows.map(p=>p.program_type_id)})]);
 }
 registerSpecialProgramBatchRoutes(app,pool,auth,{getEnrollment,permitted,change,validId,clean,invalid,errorReply});
 app.get('/api/special-programs/catalog-access',authenticateSchoolClient,staff,async(req,res)=>{
  try{const r=await pool.query('SELECT program_type_id AS "programTypeId",program_code AS code,program_name AS name,description,active FROM special_program_types WHERE school_id=$1 ORDER BY program_code',[req.auth.schoolId]);res.json({programs:r.rows});}
  catch(e){res.status(500).json({error:'Could not load program catalog.'});}
 });
 app.patch('/api/special-programs/catalog/:id',authenticateSchoolClient,admin,async(req,res)=>{
  const {code,name,description,active}=req.body||{};
  if(!validId(req.params.id)||!clean(code)||clean(code).length>30||!clean(name)||clean(name).length>120||typeof active!=='boolean'||(description!==undefined&&(typeof description!=='string'||description.length>2000)))return res.status(400).json({error:'Invalid program details.'});
  try{const r=await pool.query('UPDATE special_program_types SET program_code=$3,program_name=$4,description=$5,active=$6 WHERE school_id=$1 AND program_type_id=$2 RETURNING program_type_id AS "programTypeId",program_code AS code,program_name AS name,description,active',[req.auth.schoolId,req.params.id,clean(code).toUpperCase(),clean(name),clean(description)||null,active]);if(!r.rowCount)return res.status(404).json({error:'Program not found.'});res.json({program:r.rows[0]});}
  catch(e){errorReply(res,e);}
 });
 app.post('/api/special-programs/assignments/bulk',authenticateSchoolClient,admin,async(req,res)=>{
  const {enrollmentIds,action,programTypeId}=req.body||{},kind=String(action||'').toUpperCase();
  if(!Array.isArray(enrollmentIds)||enrollmentIds.length<1||enrollmentIds.length>200||enrollmentIds.some(id=>!validId(id))||new Set(enrollmentIds).size!==enrollmentIds.length||!['ASSIGN','REMOVE'].includes(kind)||(kind==='ASSIGN'&&!validId(programTypeId)))return res.status(400).json({error:'Choose 1–200 unique enrolled learners and a valid program action.'});
  const c=await pool.connect();
  try{await c.query('BEGIN');const changed=[];for(const id of [...enrollmentIds].sort()){const e=await getEnrollment(c,req.auth.schoolId,id);if(!e)throw invalid('Enrollment not found in your school.','INVALID_YEAR');await change(c,req.auth,e,kind,programTypeId);changed.push({enrollmentId:id,studentId:e.student_id});}await c.query('COMMIT');res.json({changed,count:changed.length});}
  catch(e){await c.query('ROLLBACK');errorReply(res,e);}finally{c.release();}
 });
 app.get('/api/special-programs/requests',authenticateSchoolClient,staff,async(req,res)=>{
  if(req.auth.role!=='SCHOOL_ADMIN'&&!mayRequest(req.auth))return res.status(403).json({error:'Only Class Advisers and Department Heads may request changes.'});
  try{const own=req.auth.role==='SCHOOL_ADMIN'?'':' AND r.requested_by_user_id=$2';const params=own?[req.auth.schoolId,req.auth.userId]:[req.auth.schoolId];
   const sql="SELECT r.request_id AS \"requestId\",r.enrollment_id AS \"enrollmentId\",r.student_id AS \"studentId\",s.full_name AS \"studentName\",e.grade_level AS \"gradeLevel\",e.section,sy.school_year_label AS \"schoolYear\",r.action,r.reason,r.status,r.batch_id AS \"batchId\",r.requested_program_type_id AS \"programTypeId\",p.program_code AS \"programCode\",p.program_name AS \"programName\",sender.display_name AS \"requestedBy\",r.created_at AS \"createdAt\",r.review_note AS \"reviewNote\",r.reviewed_at AS \"reviewedAt\" FROM special_program_change_requests r JOIN students s ON s.school_id=r.school_id AND s.student_id=r.student_id JOIN student_enrollments e ON e.school_id=r.school_id AND e.enrollment_id=r.enrollment_id JOIN school_years sy ON sy.school_id=r.school_id AND sy.school_year_id=r.school_year_id JOIN school_users sender ON sender.school_id=r.school_id AND sender.user_id=r.requested_by_user_id LEFT JOIN special_program_types p ON p.school_id=r.school_id AND p.program_type_id=r.requested_program_type_id WHERE r.school_id=$1"+own+" ORDER BY (r.status='PENDING') DESC,r.created_at DESC LIMIT 300";
   const r=await pool.query(sql,params);res.json({requests:r.rows});
  }catch(e){res.status(500).json({error:'Could not load special-program requests.'});}
 });
 app.get('/api/special-programs/requestable',authenticateSchoolClient,staff,async(req,res)=>{
  if(!mayRequest(req.auth))return res.status(403).json({error:'This role cannot request program changes.'});
  if(req.auth.role==='DEPARTMENT_HEAD'&&(!validId(req.auth.departmentId)||req.auth.departmentCode==='UNASSIGNED'))return res.json({enrollmentIds:[]});
  try{
   const params=req.auth.role==='DEPARTMENT_HEAD'?[req.auth.schoolId,req.auth.departmentId]:[req.auth.schoolId,req.auth.userId];
   const scope=req.auth.role==='DEPARTMENT_HEAD'
     ?"EXISTS(SELECT 1 FROM class_periods p WHERE p.school_id=e.school_id AND p.department_id=$2 AND p.active=TRUE AND p.grade_level=e.grade_level AND p.section=e.section) OR EXISTS(SELECT 1 FROM class_adviser_assignments ca JOIN school_users adviser ON adviser.school_id=ca.school_id AND adviser.user_id=ca.adviser_user_id AND adviser.department_id=$2 AND adviser.active=TRUE AND adviser.role='TEACHER' WHERE ca.school_id=e.school_id AND ca.grade_level=e.grade_level AND ca.section=e.section)"
     :"EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=e.school_id AND ca.adviser_user_id=$2 AND ca.grade_level=e.grade_level AND ca.section=e.section)";
   const sql="SELECT e.enrollment_id AS \"enrollmentId\" FROM student_enrollments e JOIN school_years y ON y.school_id=e.school_id AND y.school_year_id=e.school_year_id AND y.status='ACTIVE' WHERE e.school_id=$1 AND e.enrollment_status='ENROLLED' AND ("+scope+")";
   const result=await pool.query(sql,params);res.json({enrollmentIds:result.rows.map(r=>r.enrollmentId)});
  }catch(e){res.status(500).json({error:'Unable to load authorized sections.'});}
 });
 app.post('/api/special-programs/requests',authenticateSchoolClient,staff,async(req,res)=>{
  if(!mayRequest(req.auth))return res.status(403).json({error:'Only Department Heads and Class Advisers can submit program requests.'});
  const {enrollmentId,action,programTypeId,reason}=req.body||{},kind=String(action||'').toUpperCase(),note=clean(reason);
  if(!validId(enrollmentId)||!['ASSIGN','REMOVE'].includes(kind)||(kind==='ASSIGN'&&!validId(programTypeId))||note.length<3||note.length>1000)return res.status(400).json({error:'Choose a student, program action, and reason (3–1000 characters).'});
  const c=await pool.connect();
  try{await c.query('BEGIN');const e=await getEnrollment(c,req.auth.schoolId,enrollmentId);if(!e||e.year_status!=='ACTIVE'||e.enrollment_status!=='ENROLLED')throw invalid('Only active school-year enrollments can be requested.','INVALID_YEAR');
   if(!(await permitted(c,req.auth,e))){await c.query('ROLLBACK');return res.status(403).json({error:'Student outside your authorized section or department.'});}
   if(kind==='ASSIGN'){const p=await c.query('SELECT 1 FROM special_program_types WHERE school_id=$1 AND program_type_id=$2 AND active=TRUE',[req.auth.schoolId,programTypeId]);if(!p.rowCount)throw invalid('Choose an active program.','INVALID_PROGRAM');}
   const r=await c.query('INSERT INTO special_program_change_requests(school_id,student_id,school_year_id,enrollment_id,requested_program_type_id,action,reason,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING request_id AS "requestId"',[req.auth.schoolId,e.student_id,e.school_year_id,e.enrollment_id,kind==='ASSIGN'?programTypeId:null,kind,note,req.auth.userId]);await c.query('COMMIT');res.status(201).json({requestId:r.rows[0].requestId,status:'PENDING'});
  }catch(e){await c.query('ROLLBACK');errorReply(res,e);}finally{c.release();}
 });
 app.post('/api/special-programs/requests/:id/review',authenticateSchoolClient,admin,async(req,res)=>{
  const decision=String(req.body?.decision||'').toUpperCase(),reviewNote=clean(req.body?.reviewNote);
  if(!validId(req.params.id)||!['APPROVE','REJECT'].includes(decision)||reviewNote.length>1000)return res.status(400).json({error:'Invalid request or review decision.'});
  const c=await pool.connect();
  try{await c.query('BEGIN');const r=await c.query('SELECT * FROM special_program_change_requests WHERE school_id=$1 AND request_id=$2 FOR UPDATE',[req.auth.schoolId,req.params.id]);const item=r.rows[0];
   if(!item||item.status!=='PENDING'){await c.query('ROLLBACK');return res.status(409).json({error:'Request no longer pending.'});}
   if(decision==='APPROVE'){const e=await getEnrollment(c,req.auth.schoolId,item.enrollment_id);if(!e)throw invalid('Enrollment no longer exists.','INVALID_YEAR');await change(c,req.auth,e,item.action,item.requested_program_type_id);}
   const status=decision==='APPROVE'?'APPROVED':'REJECTED';
   await c.query('UPDATE special_program_change_requests SET status=$3,reviewed_by_user_id=$4,reviewed_at=NOW(),review_note=$5 WHERE school_id=$1 AND request_id=$2',[req.auth.schoolId,req.params.id,status,req.auth.userId,reviewNote||null]);
   await c.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,$3,'special_program_change_request',$4,$5::jsonb)",[req.auth.schoolId,req.auth.userId,'SPECIAL_PROGRAM_REQUEST_'+status,req.params.id,JSON.stringify({studentId:item.student_id,action:item.action})]);
   await c.query('COMMIT');res.json({status});
  }catch(e){await c.query('ROLLBACK');errorReply(res,e);}finally{c.release();}
 });
 app.get('/api/special-programs/mine',authenticateSchoolClient,async(req,res)=>{
  if(req.auth.type==='STUDENT'){
   try{const r=await pool.query(mineSql+' AND e.student_id=$2 LIMIT 1',[req.auth.schoolId,req.auth.studentId]);return res.json({students:r.rows});}
   catch(e){return res.status(500).json({error:'Could not load student program.'});}
  }
  if(req.auth.type!=='SCHOOL_USER'||req.auth.role!=='PARENT')return res.status(403).json({error:'Not authorized for personal programs.'});
  try{const r=await pool.query(mineSql+" AND EXISTS(SELECT 1 FROM parent_student_links l WHERE l.school_id=e.school_id AND l.student_id=e.student_id AND l.parent_user_id=$2 AND l.status='APPROVED')",[req.auth.schoolId,req.auth.userId]);res.json({students:r.rows});}
  catch(e){res.status(500).json({error:'Could not load linked programs.'});}
 });
}
module.exports={registerSpecialProgramRoutes};
