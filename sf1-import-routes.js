'use strict';
const crypto=require('node:crypto');
const {parseSf1Base64}=require('./sf1-import-parser');
const {parseSf1PdfBase64}=require('./sf1-pdf-parser');
const {nextStudentId}=require('./generated-record-ids');
function registerSf1ImportRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const permitted=requireSchoolRoles('SCHOOL_ADMIN','TEACHER');
 async function prepare(req,db){
  if(req.auth.role==='TEACHER'&&!req.auth.teacherDesignations?.includes('CLASS_ADVISER'))
   throw Object.assign(Error('Only Class Advisers can import an SF1 roster.'),{status:403});
  const sf1=req.body?.fileType==='pdf' ? await parseSf1PdfBase64(req.body?.fileBase64) : await parseSf1Base64(req.body?.fileBase64,req.body?.fileType||'xlsx');
  const year=await db.query("SELECT school_year_id,school_year_label,start_date FROM school_years WHERE school_id=$1 AND status='ACTIVE'",[req.auth.schoolId]);
  if(year.rowCount!==1)throw Object.assign(Error('Configure an active school year before importing SF1.'),{status:409});
  const active=year.rows[0];
  if(sf1.schoolYear&&sf1.schoolYear.replace(/[^0-9]/g,'').slice(0,4)!==String(active.school_year_label).slice(0,4))
   throw Object.assign(Error('SF1 school year does not match the active school year.'),{status:409});
  if(req.auth.role==='TEACHER'){
   const grades=await db.query("SELECT DISTINCT grade_level FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2",[req.auth.schoolId,req.auth.userId]);
   if(!grades.rows.some(r=>r.grade_level.toUpperCase()===sf1.gradeLevel.toUpperCase()))
    throw Object.assign(Error('The SF1 grade is outside your authorized advisory grade. Ask School Admin for assignment.'),{status:403});
  }
  if(sf1.errors.length)throw Object.assign(Error('SF1 contains '+sf1.errors.length+' rows needing correction; no students were saved.'),{status:422,details:sf1.errors.slice(0,25)});
  const lrnList=sf1.learners.map(r=>r.lrn);
  if(new Set(lrnList).size!==lrnList.length)throw Object.assign(Error('Duplicate LRNs found in the uploaded SF1.'),{status:409});
  const existing=await db.query("SELECT lrn,student_id,full_name,active,archived_at FROM students WHERE school_id=$1 AND lrn=ANY($2::text[])",[req.auth.schoolId,lrnList]);
  const match=new Map(existing.rows.map(r=>[r.lrn,r]));
  const rows=sf1.learners.map(r=>{
   const found=match.get(r.lrn);
   return {...r,action:found?(found.active&&!found.archived_at?'SKIP':'REVIEW'):'CREATE',
    existingStudent:found?{studentId:found.student_id,fullName:found.full_name}:null};
  });
  const summary={create:rows.filter(r=>r.action==='CREATE').length,skip:rows.filter(r=>r.action==='SKIP').length,review:rows.filter(r=>r.action==='REVIEW').length};
  return {rows,summary,schoolYearId:active.school_year_id,year:Number(String(active.school_year_label).slice(0,4)),gradeLevel:sf1.gradeLevel};
 }
 app.post('/api/students/sf1/preview',authenticateSchoolClient,permitted,async(req,res)=>{
  try{const result=await prepare(req,pool);res.json({rows:result.rows,summary:result.summary,gradeLevel:result.gradeLevel,section:'Unassigned',total:result.rows.length});}
  catch(e){res.status(e.status||400).json({error:e.message,details:e.details||[]});}
 });
 app.post('/api/students/sf1/commit',authenticateSchoolClient,permitted,async(req,res)=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // The preview is informational; all checks are repeated inside the commit.
   const prepared=await prepare(req,client);
   if(prepared.summary.review)throw Object.assign(Error('An archived or inactive LRN needs School Admin review.'),{status:409});
   let created=0;
   for(const row of prepared.rows.filter(r=>r.action==='CREATE')){
    // Lock existing LRN namespace within this school to prevent concurrent import races.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',[req.auth.schoolId,row.lrn]);
    const duplicate=await client.query('SELECT student_id FROM students WHERE school_id=$1 AND lrn=$2',[req.auth.schoolId,row.lrn]);
    if(duplicate.rowCount)continue;
    const id=await nextStudentId(client,{year:prepared.year});
    await client.query(`INSERT INTO students(school_id,student_id,lrn,full_name,grade_level,section,parent_mobile,sex,qr_token)
      VALUES($1,$2,$3,$4,$5,'Unassigned','',$6,gen_random_uuid())`,
      [req.auth.schoolId,id,row.lrn,row.fullName,row.gradeLevel,row.sex]);
    await client.query(`INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
      VALUES($1,$2,$3,$4,'Unassigned',CURRENT_DATE,'ENROLLED',$5)`,
      [req.auth.schoolId,id,prepared.schoolYearId,row.gradeLevel,req.auth.userId]);
    created++;
   }
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'STUDENT_SF1_IMPORT','student_import',$3,$4::jsonb)`,
     [req.auth.schoolId,req.auth.userId,crypto.randomUUID(),JSON.stringify({created,skipped:prepared.rows.length-created,gradeLevel:prepared.gradeLevel,section:'Unassigned'})]);
   await client.query('COMMIT');
   res.json({ok:true,created,skipped:prepared.rows.length-created,gradeLevel:prepared.gradeLevel});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(e.status||(e.code==='23505'?409:500)).json({error:e.status?e.message:e.code==='23505'?'An LRN was concurrently registered; preview again.':'SF1 import failed without saving changes.'});}
  finally{client.release();}
 });
 app.post('/api/students/sf1/sections',authenticateSchoolClient,permitted,async(req,res)=>{
  const gradeLevel=String(req.body?.gradeLevel||'').trim(),section=String(req.body?.section||'').trim();
  if(!/^Grade (?:[1-9]|1[0-2])$/.test(gradeLevel)||!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(section)||/^unassigned$/i.test(section))
   return res.status(400).json({error:'Select a valid grade and new section name.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   if(req.auth.role==='TEACHER'){
    const scope=await client.query(`SELECT 1 FROM class_adviser_assignments ca
      WHERE ca.school_id=$1 AND ca.adviser_user_id=$2 AND ca.grade_level=$3
      AND EXISTS(SELECT 1 FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id
        WHERE e.school_id=$1 AND e.created_by_user_id=$2 AND e.grade_level=$3 AND e.section='Unassigned'
          AND e.enrollment_status='ENROLLED' AND sy.status='ACTIVE') LIMIT 1`,
      [req.auth.schoolId,req.auth.userId,gradeLevel]);
    if(!scope.rowCount)throw Object.assign(Error('You can create sections only for an authorized advisory grade with your imported unassigned learners.'),{status:403});
   }
   const result=await client.query(`INSERT INTO school_sections(school_id,grade_level,section_name)
    VALUES($1,$2,$3) ON CONFLICT(school_id,grade_level,section_name) DO NOTHING RETURNING section_name`,
    [req.auth.schoolId,gradeLevel,section]);
   if(!result.rowCount)throw Object.assign(Error('This section already exists. Choose it from the section list.'),{status:409});
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'SCHOOL',$2,'TEACHER_CREATE_SECTION','school_section',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,crypto.randomUUID(),JSON.stringify({gradeLevel,section})]);
   await client.query('COMMIT');res.status(201).json({ok:true,section,gradeLevel});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(e.status||(e.code==='23505'?409:500)).json({error:e.status?e.message:'Could not create section.'});}
  finally{client.release();}
 });
}
module.exports={registerSf1ImportRoutes};