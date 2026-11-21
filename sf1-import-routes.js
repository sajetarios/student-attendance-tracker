'use strict';
const crypto=require('node:crypto');
const {parseSf1Base64,normalizeGuardianContact}=require('./sf1-import-parser');
const {parseSf1PdfBase64}=require('./sf1-pdf-parser');
const {nextStudentId}=require('./generated-record-ids');
const PROFILE_FIELDS=[['fatherName','father_name'],['motherMaidenName','mother_maiden_name'],['sf1GuardianName','sf1_guardian_name'],['birthDate','birth_date'],['sf1Address','sf1_address']];
const validValue=x=>String(x||'').trim();
function registerSf1ImportRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const permitted=requireSchoolRoles('SCHOOL_ADMIN','TEACHER');
 async function prepare(req,db){
  if(req.auth.role==='TEACHER'&&!req.auth.teacherDesignations?.includes('CLASS_ADVISER'))
   throw Object.assign(Error('Only Class Advisers can import an SF1 roster.'),{status:403});
  const sf1=req.body?.fileType==='pdf' ? await parseSf1PdfBase64(req.body?.fileBase64) : await parseSf1Base64(req.body?.fileBase64,req.body?.fileType||'xlsx');
  const year=await db.query("SELECT school_year_id,school_year_label,start_date FROM school_years WHERE school_id=$1 AND status='ACTIVE'",[req.auth.schoolId]);
  if(year.rowCount!==1)throw Object.assign(Error('Configure an active school year before importing SF1.'),{
   status:409,code:'SF1_SCHOOL_YEAR_REQUIRED',schoolYear:sf1.schoolYear||''
  });
  const enabled=await db.query('SELECT school_offers_grade($1,$2) AS allowed',[req.auth.schoolId,sf1.gradeLevel]);
  if(!enabled.rows[0]?.allowed)throw Object.assign(Error('This SF1 grade is disabled in School Years & Enrollment → School levels. Enable SHS first.'),{status:409});
  const active=year.rows[0];
  if(sf1.schoolYear&&sf1.schoolYear.replace(/[^0-9]/g,'').slice(0,4)!==String(active.school_year_label).slice(0,4))
   throw Object.assign(Error('SF1 school year does not match the active school year.'),{status:409});
  if(req.auth.role==='TEACHER'){
   const grades=await db.query("SELECT DISTINCT grade_level FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2",[req.auth.schoolId,req.auth.userId]);
   if(!grades.rows.some(r=>r.grade_level.toUpperCase()===sf1.gradeLevel.toUpperCase()))
    throw Object.assign(Error('The SF1 grade is outside your authorized advisory grade. Ask School Admin for assignment.'),{status:403});
  }
  if(sf1.errors.length)throw Object.assign(Error('SF1 contains '+sf1.errors.length+(sf1.errors.length===1?' row':' rows')+' needing correction; no students were saved.'),{status:422,details:sf1.errors.slice(0,25)});
  const lrnList=sf1.learners.map(r=>r.lrn);
  if(new Set(lrnList).size!==lrnList.length)throw Object.assign(Error('Duplicate LRNs found in the uploaded SF1.'),{status:409});
  // LRN is the only automatic identity match. Similar names are held for review.
  const canonical=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const named=sf1.learners.map(r=>canonical(r.fullName));
  const existing=await db.query(
   "SELECT lrn,student_id,full_name,parent_name,parent_mobile,father_name,mother_maiden_name,sf1_guardian_name,birth_date,sf1_address,sex,grade_level,section,active,archived_at FROM students WHERE school_id=$1 AND (lrn=ANY($2::text[]) OR lower(regexp_replace(full_name,'[^a-zA-Z0-9]','','g'))=ANY($3::text[]))"+(db===pool?'':' FOR UPDATE'),
   [req.auth.schoolId,lrnList,named]
  );
  const match=new Map(existing.rows.filter(r=>r.lrn).map(r=>[r.lrn,r]));
  const byName=new Map();
  for(const student of existing.rows){
   const key=canonical(student.full_name);
   if(!byName.has(key))byName.set(key,[]);
   byName.get(key).push(student);
  }
  let advisoryUpdateIds=null;
  if(req.auth.role==='TEACHER'){
   const ids=existing.rows.map(r=>r.student_id);
   const entitled=ids.length?await db.query(`SELECT DISTINCT e.student_id FROM student_enrollments e
     JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id
     WHERE e.school_id=$1 AND e.student_id=ANY($2::text[]) AND sy.status='ACTIVE'
       AND e.enrollment_status='ENROLLED' AND
       (EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=$1
         AND ca.adviser_user_id=$3 AND ca.grade_level=e.grade_level AND ca.section=e.section)
        OR (e.section='Unassigned' AND e.created_by_user_id=$3 AND EXISTS
         (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=$1 AND ca.adviser_user_id=$3
          AND ca.grade_level=e.grade_level)))`,[req.auth.schoolId,ids,req.auth.userId]):{rows:[]};
   advisoryUpdateIds=new Set(entitled.rows.map(r=>r.student_id));
  }
  // One reviewed import proposes every safely recoverable missing field.
  const recoverMissingLrn=req.body?.recoverMissingLrn!==false;
  const rows=sf1.learners.map(r=>{
   const found=match.get(r.lrn);
   const similar=(byName.get(canonical(r.fullName))||[]).filter(student=>student.lrn!==r.lrn);
   const recoveryCandidate=!found&&similar.length===1&&
    !String(similar[0].lrn||'').trim()&&similar[0].active===true&&!similar[0].archived_at&&
    String(similar[0].sex||'').toUpperCase()===r.sex&&
    String(similar[0].grade_level||'').toUpperCase()===r.gradeLevel.toUpperCase();
   const existingStudent=found||similar[0]||null;
   const missingFields=[];
   if(existingStudent){
    if(r.parentName&&!validValue(existingStudent.parent_name))missingFields.push('parentName');
    if(r.parentMobile&&!validValue(existingStudent.parent_mobile))missingFields.push('parentMobile');
    for(const [key,column] of PROFILE_FIELDS)if(validValue(r[key])&&!validValue(existingStudent[column]))missingFields.push(key);
    if(!found&&recoveryCandidate)missingFields.unshift('lrn');
   }
   const issues=[];
   let action='CREATE';
   if(!found&&similar.length){
    if(recoveryCandidate&&recoverMissingLrn){
     if(advisoryUpdateIds&&!advisoryUpdateIds.has(similar[0].student_id))issues.push('Existing learner is outside your assigned advisory section.');
     action=issues.length?'REVIEW':'RECOVER';
    }else{
     action='REVIEW';issues.push(recoveryCandidate?'Exact name, sex and grade match an existing learner with no LRN. Enable reviewed LRN recovery to fill the blank field.':'Existing learner with this name has a missing/different LRN. Manual review required; no duplicate was created.');
    }
   }else if(found){
    if(!found.active||found.archived_at)issues.push('This LRN is archived or inactive; School Admin review required.');
    if(canonical(found.full_name)!==canonical(r.fullName))issues.push('Name differs from the saved LRN record.');
    if(found.sex&&String(found.sex).toUpperCase()!==r.sex)issues.push('Sex differs from the saved LRN record.');
    if(r.parentName&&found.parent_name&&canonical(found.parent_name)!==canonical(r.parentName))
     issues.push('Parent/guardian name conflicts with the saved value.');
    if(r.parentMobile&&found.parent_mobile&&
      normalizeGuardianContact(found.parent_mobile)!==r.parentMobile)
     issues.push('Parent/guardian contact conflicts with the saved value.');
    const needsFill=missingFields.length>0;
    if(needsFill&&advisoryUpdateIds&&!advisoryUpdateIds.has(found.student_id))
     issues.push('Existing learner is outside your assigned advisory section.');
    action=issues.length?'REVIEW':needsFill?'UPDATE':'SKIP';
   }
   return {...r,action,errors:issues,missingFields,
    existingStudent:existingStudent?{
     studentId:existingStudent.student_id,fullName:existingStudent.full_name,
     values:{lrn:existingStudent.lrn||'',parentName:existingStudent.parent_name||'',parentMobile:existingStudent.parent_mobile||'',fatherName:existingStudent.father_name||'',motherMaidenName:existingStudent.mother_maiden_name||'',sf1GuardianName:existingStudent.sf1_guardian_name||'',birthDate:existingStudent.birth_date?String(existingStudent.birth_date).slice(0,10):'',sf1Address:existingStudent.sf1_address||''}
    }:null};
  });
  const summary={create:0,update:0,recover:0,skip:0,review:0};
  rows.forEach(row=>{summary[row.action.toLowerCase()]++;});
  return {rows,summary,schoolYearId:active.school_year_id,year:Number(String(active.school_year_label).slice(0,4)),gradeLevel:sf1.gradeLevel};
 }
 app.post('/api/students/sf1/preview',authenticateSchoolClient,permitted,async(req,res)=>{
  try{const result=await prepare(req,pool);res.json({rows:result.rows,summary:result.summary,gradeLevel:result.gradeLevel,section:'Unassigned',total:result.rows.length});}
  catch(e){res.status(e.status||400).json({error:e.message,details:e.details||[],...(e.code==='SF1_SCHOOL_YEAR_REQUIRED'?{code:e.code,schoolYear:e.schoolYear}: {})});}
 });
 app.post('/api/students/sf1/commit',authenticateSchoolClient,permitted,async(req,res)=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // The preview is informational; all checks are repeated inside the commit.
   const prepared=await prepare(req,client);
   if(prepared.summary.review)throw Object.assign(Error('Resolve SF1 review flags before saving. No student records were changed.'),{status:409});
   let created=0,updated=0;
   for(const row of prepared.rows.filter(r=>r.action==='CREATE')){
    // Lock existing LRN namespace within this school to prevent concurrent import races.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',[req.auth.schoolId,row.lrn]);
    const duplicate=await client.query('SELECT student_id FROM students WHERE school_id=$1 AND lrn=$2',[req.auth.schoolId,row.lrn]);
    if(duplicate.rowCount)continue;
    const id=await nextStudentId(client,{year:prepared.year});
    await client.query(`INSERT INTO students(school_id,student_id,lrn,full_name,grade_level,section,parent_name,parent_mobile,sex,qr_token,father_name,mother_maiden_name,sf1_guardian_name,birth_date,sf1_address)
      VALUES($1,$2,$3,$4,$5,'Unassigned',$6,$7,$8,gen_random_uuid(),$9,$10,$11,$12,$13)`,
      [req.auth.schoolId,id,row.lrn,row.fullName,row.gradeLevel,row.parentName||null,row.parentMobile||'',row.sex,row.fatherName||null,row.motherMaidenName||null,row.sf1GuardianName||null,row.birthDate||null,row.sf1Address||null]);
    await client.query(`INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
      VALUES($1,$2,$3,$4,'Unassigned',CURRENT_DATE,'ENROLLED',$5)`,
      [req.auth.schoolId,id,prepared.schoolYearId,row.gradeLevel,req.auth.userId]);
    created++;
   }
   // Recover missing LRNs only with explicit opt-in and unique exact matching.
   for(const row of prepared.rows.filter(r=>r.action==='RECOVER')){
    const saved=await client.query(`UPDATE students
      SET lrn=$3,
       parent_name=CASE WHEN NULLIF(BTRIM(parent_name),'') IS NULL THEN NULLIF($4,'') ELSE parent_name END,
       parent_mobile=CASE WHEN NULLIF(BTRIM(parent_mobile),'') IS NULL THEN $5 ELSE parent_mobile END,
       father_name=COALESCE(NULLIF(BTRIM(father_name),''),NULLIF($6,'')),
       mother_maiden_name=COALESCE(NULLIF(BTRIM(mother_maiden_name),''),NULLIF($7,'')),
       sf1_guardian_name=COALESCE(NULLIF(BTRIM(sf1_guardian_name),''),NULLIF($8,'')),
       birth_date=COALESCE(birth_date,$9::date),
       sf1_address=COALESCE(NULLIF(BTRIM(sf1_address),''),NULLIF($10,'')),
       updated_at=NOW()
      WHERE school_id=$1 AND student_id=$2 AND NULLIF(BTRIM(lrn),'') IS NULL
       AND active=TRUE AND archived_at IS NULL
      RETURNING student_id`,[req.auth.schoolId,row.existingStudent.studentId,row.lrn,row.parentName,row.parentMobile,row.fatherName||'',row.motherMaidenName||'',row.sf1GuardianName||'',row.birthDate||null,row.sf1Address||'']);
    if(saved.rowCount!==1)throw Object.assign(Error('Learner LRN changed during review. Preview again.'),{status:409});
    updated++;
   }
   // Preserve identity, enrollment, QR tokens and attendance on existing rows.
   // Locks taken during prepare guard the preview and write in this transaction.
   for(const row of prepared.rows.filter(r=>r.action==='UPDATE')){
    const saved=await client.query(`UPDATE students
      SET parent_name=CASE WHEN NULLIF(BTRIM(parent_name),'') IS NULL
         THEN NULLIF($4,'') ELSE parent_name END,
       parent_mobile=CASE WHEN NULLIF(BTRIM(parent_mobile),'') IS NULL
         THEN $5 ELSE parent_mobile END,
       father_name=COALESCE(NULLIF(BTRIM(father_name),''),NULLIF($6,'')),
       mother_maiden_name=COALESCE(NULLIF(BTRIM(mother_maiden_name),''),NULLIF($7,'')),
       sf1_guardian_name=COALESCE(NULLIF(BTRIM(sf1_guardian_name),''),NULLIF($8,'')),
       birth_date=COALESCE(birth_date,$9::date),
       sf1_address=COALESCE(NULLIF(BTRIM(sf1_address),''),NULLIF($10,'')),
       updated_at=NOW()
      WHERE school_id=$1 AND student_id=$2 AND lrn=$3 AND active=TRUE AND archived_at IS NULL
      RETURNING student_id`,[req.auth.schoolId,row.existingStudent.studentId,row.lrn,row.parentName,row.parentMobile,row.fatherName||'',row.motherMaidenName||'',row.sf1GuardianName||'',row.birthDate||null,row.sf1Address||'']);
    if(saved.rowCount!==1)throw Object.assign(Error('Learner record changed during review. Preview again.'),{status:409});
    updated++;
   }
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'STUDENT_SF1_IMPORT','student_import',$3,$4::jsonb)`,
     [req.auth.schoolId,req.auth.userId,crypto.randomUUID(),JSON.stringify({created,updated,recovered:prepared.summary.recover,skipped:prepared.summary.skip,gradeLevel:prepared.gradeLevel,section:'Unassigned',identityAndAttendancePreserved:true})]);
   await client.query('COMMIT');
   res.json({ok:true,created,updated,recovered:prepared.summary.recover,skipped:prepared.summary.skip,gradeLevel:prepared.gradeLevel});
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