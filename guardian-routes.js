'use strict';
const valid = (v,max=160)=>typeof v==='string' && v.trim().length>0 && v.trim().length<=max;
function registerGuardianRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const allowed=requireSchoolRoles('SCHOOL_ADMIN','TEACHER');
 const admin=requireSchoolRoles('SCHOOL_ADMIN');
 async function scope(client,auth,studentId) {
  const s=await client.query('SELECT student_id,parent_name,parent_mobile FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE',[auth.schoolId,studentId]);
  if(!s.rowCount) return null;
  if(auth.role==='SCHOOL_ADMIN') return s.rows[0];
  if(!auth.teacherDesignations?.includes('CLASS_ADVISER')) return null;
  const q=await client.query(`SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=$1 AND ca.adviser_user_id=$2 AND EXISTS (
   SELECT 1 FROM students s WHERE s.school_id=ca.school_id AND s.student_id=$3 AND
   ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' LIMIT 1),s.grade_level)
   AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' LIMIT 1),s.section)) LIMIT 1`,[auth.schoolId,auth.userId,studentId]);
  return q.rowCount?s.rows[0]:null;
 }
 app.get('/api/guardians/students/:studentId',authenticateSchoolClient,allowed,async(req,res)=>{
  try {
   if(!await scope(pool,req.auth,req.params.studentId))return res.status(404).json({error:'Student not found in your authorized scope.'});
   const [g,r]=await Promise.all([
    pool.query('SELECT guardian_id AS "guardianId",full_name AS "fullName",mobile,relationship,is_primary AS "isPrimary",active FROM student_guardians WHERE school_id=$1 AND student_id=$2 ORDER BY active DESC,is_primary DESC,created_at',[req.auth.schoolId,req.params.studentId]),
    pool.query('SELECT request_id AS "requestId",request_type AS "requestType",proposed_name AS "proposedName",relationship,status,created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM guardian_change_requests WHERE school_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 100',[req.auth.schoolId,req.params.studentId])
   ]);
   res.json({guardians:g.rows,requests:r.rows});
  }catch(e){console.error('Guardian view:',e.message);res.status(500).json({error:'Could not load guardians.'});}
 });
 app.post('/api/guardians/students/:studentId/requests',authenticateSchoolClient,allowed,async(req,res)=>{
  const {requestType,fullName,mobile,relationship,reason}=req.body||{};
  if(!['ADD','CHANGE_PRIMARY','CORRECT'].includes(requestType)||!valid(fullName)||!valid(mobile,30)||!valid(relationship,80)||!valid(reason,1000))
   return res.status(400).json({error:'Provide request type, guardian name, mobile, relationship and reason.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const s=await scope(client,req.auth,req.params.studentId);
   if(!s){await client.query('ROLLBACK');return res.status(404).json({error:'Student not found in your authorized scope.'});}
   const pending=await client.query("SELECT 1 FROM guardian_change_requests WHERE school_id=$1 AND student_id=$2 AND status='PENDING' AND request_type=$3 LIMIT 1",[req.auth.schoolId,req.params.studentId,requestType]);
   if(pending.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'A request of this type is already pending for this learner.'});}
   const q=await client.query(`INSERT INTO guardian_change_requests(school_id,student_id,requested_by_user_id,request_type,proposed_name,proposed_mobile,relationship,reason,previous_name,previous_mobile)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING request_id AS "requestId",status`,
    [req.auth.schoolId,req.params.studentId,req.auth.userId,requestType,fullName.trim(),mobile.trim(),relationship.trim(),reason.trim(),s.parent_name,s.parent_mobile]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'SCHOOL',$2,'GUARDIAN_CHANGE_REQUESTED','student',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,req.params.studentId,JSON.stringify({requestId:q.rows[0].requestId,requestType})]);
   await client.query('COMMIT');res.status(201).json({request:q.rows[0],portalAccessChanged:false});
  }catch(e){await client.query('ROLLBACK');console.error('Guardian request:',e.message);res.status(500).json({error:'Could not submit request.'});}finally{client.release();}
 });
 app.get('/api/guardians/requests',authenticateSchoolClient,admin,async(req,res)=>{
  try{const q=await pool.query(`SELECT request_id AS "requestId",student_id AS "studentId",request_type AS "requestType",proposed_name AS "proposedName",proposed_mobile AS "proposedMobile",relationship,reason,status,previous_name AS "previousName",previous_mobile AS "previousMobile",created_at AS "createdAt",review_note AS "reviewNote",reviewed_at AS "reviewedAt"
   FROM guardian_change_requests WHERE school_id=$1 ORDER BY (status='PENDING') DESC,created_at DESC LIMIT 300`,[req.auth.schoolId]);res.json({requests:q.rows});}
  catch(e){console.error('Guardian requests:',e.message);res.status(500).json({error:'Could not load requests.'});}
 });
 app.post('/api/guardians/requests/:requestId/review',authenticateSchoolClient,admin,async(req,res)=>{
  const {decision,note}=req.body||{};
  if(!['APPROVED','REJECTED'].includes(decision)||!valid(note,1000))return res.status(400).json({error:'Decision and review note required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('SELECT * FROM guardian_change_requests WHERE school_id=$1 AND request_id=$2 FOR UPDATE',[req.auth.schoolId,req.params.requestId]);
   if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Request not found.'});}
   const r=q.rows[0];
   if(r.status!=='PENDING'){await client.query('ROLLBACK');return res.status(409).json({error:'Request already reviewed.'});}
   if(decision==='APPROVED'){
    await client.query('SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2 FOR UPDATE',[req.auth.schoolId,r.student_id]);
    if(r.request_type!=='ADD'){
     await client.query('UPDATE student_guardians SET is_primary=FALSE,active=CASE WHEN $3 THEN FALSE ELSE active END,updated_at=NOW() WHERE school_id=$1 AND student_id=$2 AND is_primary=TRUE',[req.auth.schoolId,r.student_id,r.request_type==='CHANGE_PRIMARY']);
    }
    await client.query(`INSERT INTO student_guardians(school_id,student_id,full_name,mobile,relationship,is_primary,source_request_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[req.auth.schoolId,r.student_id,r.proposed_name,r.proposed_mobile,r.relationship,r.request_type!=='ADD',r.request_id]);
    if(r.request_type!=='ADD')await client.query('UPDATE students SET parent_name=$3,parent_mobile=$4,updated_at=NOW() WHERE school_id=$1 AND student_id=$2',[req.auth.schoolId,r.student_id,r.proposed_name,r.proposed_mobile]);
   }
   await client.query('UPDATE guardian_change_requests SET status=$3,reviewed_by_user_id=$4,review_note=$5,reviewed_at=NOW() WHERE school_id=$1 AND request_id=$2',[req.auth.schoolId,r.request_id,decision,req.auth.userId,note.trim()]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'SCHOOL',$2,'GUARDIAN_CHANGE_REVIEWED','student',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,r.student_id,JSON.stringify({requestId:r.request_id,decision,requestType:r.request_type,previousName:r.previous_name,newName:r.proposed_name,note:note.trim(),portalAccessChanged:false})]);
   await client.query('COMMIT');res.json({status:decision,portalAccessChanged:false});
  }catch(e){await client.query('ROLLBACK');console.error('Guardian review:',e.message);res.status(500).json({error:'Could not review request.'});}finally{client.release();}
 });
}
module.exports={registerGuardianRoutes};
