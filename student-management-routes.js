'use strict';
const ExcelJS = require('exceljs');
const MAX_ROWS = 2000, MAX_BYTES = 5 * 1024 * 1024;
const clean = v => String(v ?? '').trim();
const headerMap = {studentid:'studentId',studentno:'studentId',studentnumber:'studentId',fullname:'fullName',studentname:'fullName',name:'fullName',sex:'sex',gender:'sex',grade:'gradeLevel',gradelevel:'gradeLevel',yearlevel:'gradeLevel',section:'section',lrn:'lrn',parentname:'parentName',guardianname:'parentName',parentmobile:'parentMobile',guardianmobile:'parentMobile'};
function csvRows(text) {
 const rows=[];let row=[],v='',q=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'&&text[i+1]==='"'){v+='"';i++;}else if(c==='"')q=false;else v+=c;}else if(c==='"'&&!v)q=true;else if(c===','){row.push(v);v='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);v='';if(row.some(x=>clean(x)))rows.push(row);row=[];}else v+=c;}
 row.push(v);if(row.some(x=>clean(x)))rows.push(row);if(q)throw Error('CSV quotation marks are incomplete.');return rows;
}
async function readRows(body){
 let matrix;
 if(typeof body.csvText==='string'){if(Buffer.byteLength(body.csvText)>MAX_BYTES)throw Error('CSV must be 5 MB or smaller.');matrix=csvRows(body.csvText);}
 else if(typeof body.fileBase64==='string'){const b=Buffer.from(body.fileBase64,'base64');if(!b.length||b.length>MAX_BYTES)throw Error('Excel file must be 5 MB or smaller.');const w=new ExcelJS.Workbook();await w.xlsx.load(b);const sh=w.worksheets[0];if(!sh)throw Error('No worksheet found.');matrix=[];sh.eachRow({includeEmpty:false},r=>matrix.push(r.values.slice(1).map(c=>c&&typeof c==='object'&&'text'in c?c.text:c&&typeof c==='object'&&'result'in c?c.result:c==null?'':String(c))));}
 else throw Error('Choose a CSV or Excel (.xlsx) file.');
 if(matrix.length<2||matrix.length-1>MAX_ROWS)throw Error('The file must contain 1–2,000 student rows and a header row.');
 const keys=matrix[0].map(h=>headerMap[clean(h).toLowerCase().replace(/[^a-z0-9]/g,'')]||null);
 for(const k of ['studentId','fullName','sex','gradeLevel','section'])if(!keys.includes(k))throw Error('Required columns: Student ID, Full Name, Sex, Grade Level, Section.');
 return matrix.slice(1).map((r,i)=>{const o={rowNumber:i+2};keys.forEach((k,j)=>{if(k)o[k]=clean(r[j]);});return o;}).filter(r=>Object.values(r).some(v=>clean(v)));
}
function validate(r){const e=[];if(!r.studentId||r.studentId.length>80)e.push('Student ID is required (max 80).');if(!r.fullName||r.fullName.length>200)e.push('Full name is required (max 200).');if(!['MALE','FEMALE'].includes(clean(r.sex).toUpperCase()))e.push('Sex must be Male or Female.');if(!r.gradeLevel||r.gradeLevel.length>40)e.push('Grade level is required (max 40).');if(!r.section||r.section.length>100)e.push('Section is required (max 100).');if((r.lrn||'').length>30)e.push('LRN is too long.');if((r.parentName||'').length>160)e.push('Parent name is too long.');if((r.parentMobile||'').length>30)e.push('Parent mobile is too long.');return e;}
function normalizeGradeLevel(value){const text=clean(value).toUpperCase().replace(/\s+/g,' ');const match=text.match(/^(?:GRADE|GR)\s*(\d+)$/)||text.match(/^(\d+)$/);return match?'GRADE '+Number(match[1]):text;}
function normalizeSection(value){return clean(value).toUpperCase().replace(/\s+/g,' ');}
function registerStudentManagementRoutes(app,pool,auth){
 const {authenticateSchoolClient,requireSchoolRoles}=auth;
 const manager=requireSchoolRoles('SCHOOL_ADMIN','TEACHER'),admin=requireSchoolRoles('SCHOOL_ADMIN');
 async function preview(req,rows){
  const ids=[...new Set(rows.map(r=>clean(r.studentId)).filter(Boolean))],lrns=[...new Set(rows.map(r=>clean(r.lrn)).filter(Boolean))];
  const ex=ids.length?await pool.query('SELECT student_id AS id,(school_id=$1) AS in_school,active,archived_at FROM students WHERE student_id=ANY($2::text[])',[req.auth.schoolId,ids]):{rows:[]};
  const em=new Map(ex.rows.map(x=>[x.id,x]));
  const lx=lrns.length?await pool.query('SELECT lrn,student_id FROM students WHERE school_id=$1 AND lrn=ANY($2::text[])',[req.auth.schoolId,lrns]):{rows:[]};
  const lm=new Map(lx.rows.map(x=>[x.lrn,x.student_id]));
  let allowed=[];
  let selectedScope=null;
  let scopeSelectionError=null;
  if(req.auth.role==='TEACHER'){
   if(!req.auth.teacherDesignations?.includes('CLASS_ADVISER'))return rows.map(r=>({...r,action:'ERROR',errors:['Only Class Advisers may bulk-register students.']}));
   const a=await pool.query('SELECT assignment_id AS "assignmentId",grade_level AS "gradeLevel",section FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2',[req.auth.schoolId,req.auth.userId]);
   allowed=a.rows;
   const requestedAssignmentId=clean(req.body?.advisoryAssignmentId);
   if(requestedAssignmentId){
    selectedScope=allowed.find(item=>String(item.assignmentId)===requestedAssignmentId)||null;
    if(!selectedScope)scopeSelectionError='The selected import destination is not assigned to your advisory account.';
   }else if(allowed.length===1){
    selectedScope=allowed[0];
   }
   if(selectedScope){
    rows=rows.map(r=>({...r,gradeLevel:selectedScope.gradeLevel,section:selectedScope.section,advisoryScopeApplied:true}));
   }
  }
  const seen=new Set(),seenLrn=new Set();
  return rows.map(r=>{
   const errors=validate(r),id=clean(r.studentId),lrn=clean(r.lrn),found=em.get(id);if(seen.has(id))errors.push('Student ID is duplicated in this file.');seen.add(id);
   if(lrn&&seenLrn.has(lrn))errors.push('LRN is duplicated in this file.');if(lrn)seenLrn.add(lrn);
   if(scopeSelectionError)errors.push(scopeSelectionError);
   if(req.auth.role==='TEACHER'&&!scopeSelectionError&&!allowed.some(item=>normalizeGradeLevel(item.gradeLevel)===normalizeGradeLevel(r.gradeLevel)&&normalizeSection(item.section)===normalizeSection(r.section)))errors.push(allowed.length?'Grade/section is not assigned to your advisory account.':'No advisory section is assigned to your account. Ask the School Administrator to assign your class first.');
   let action='CREATE';
   if(found&&!found.in_school)errors.push('Student ID is already in use and cannot be registered for this school.');
   else if(found&&(!found.active||found.archived_at))errors.push('Student is inactive or archived; ask the administrator to review.');
   else if(found&&req.auth.role==='TEACHER')errors.push('Student already exists. Teacher imports can only add new students.');
   else if(found)action='UPDATE';
   if(lrn&&lm.has(lrn)&&lm.get(lrn)!==id)errors.push('LRN already belongs to another student.');
   if(errors.length)action='ERROR';
   return {...r,sex:clean(r.sex).toUpperCase(),action,errors};
  });
 }
 app.post('/api/students/import/preview',authenticateSchoolClient,manager,async(req,res)=>{
  try{const rows=await readRows(req.body||{}),checked=await preview(req,rows);const summary={create:0,update:0,error:0};checked.forEach(r=>summary[r.action.toLowerCase()]++);res.json({rows:checked,summary,total:checked.length});}
  catch(e){res.status(400).json({error:e.message||'Could not read import file.'});}
 });
 app.post('/api/students/import/commit',authenticateSchoolClient,manager,async(req,res)=>{
  let rows;try{rows=await readRows(req.body||{});}catch(e){return res.status(400).json({error:e.message});}
  const checked=await preview(req,rows),bad=checked.filter(r=>r.action==='ERROR');if(bad.length)return res.status(409).json({error:'Import has errors. Correct the file and preview again.',rows:bad});
  const c=await pool.connect();let created=0,updated=0;
  try{
   await c.query('BEGIN');const y=await c.query("SELECT school_year_id FROM school_years WHERE school_id=$1 AND status='ACTIVE' FOR SHARE",[req.auth.schoolId]);
   for(const r of checked){
    const saved=await c.query(`INSERT INTO students(school_id,student_id,lrn,full_name,grade_level,section,parent_name,parent_mobile,sex,qr_token)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,gen_random_uuid())
     ON CONFLICT(student_id) DO UPDATE SET lrn=EXCLUDED.lrn,full_name=EXCLUDED.full_name,parent_name=EXCLUDED.parent_name,parent_mobile=EXCLUDED.parent_mobile,sex=EXCLUDED.sex,qr_token=COALESCE(students.qr_token,EXCLUDED.qr_token),updated_at=NOW()
     WHERE students.school_id=EXCLUDED.school_id AND students.active=TRUE AND students.archived_at IS NULL RETURNING student_id`,
     [req.auth.schoolId,r.studentId,r.lrn||null,r.fullName,y.rowCount?'Unassigned':r.gradeLevel,y.rowCount?'Unassigned':r.section,r.parentName||null,r.parentMobile||'',r.sex]);
    if(!saved.rowCount)throw Object.assign(Error('A record changed during import. Preview again.'),{statusCode:409});
    if(y.rowCount)await c.query(`INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
     VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'ENROLLED',$6)
     ON CONFLICT(school_id,student_id,school_year_id) DO UPDATE SET grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,updated_at=NOW()
     WHERE student_enrollments.enrollment_status='ENROLLED'`,[req.auth.schoolId,r.studentId,y.rows[0].school_year_id,r.gradeLevel,r.section,req.auth.userId]);
    else await c.query('UPDATE students SET grade_level=$3,section=$4 WHERE school_id=$1 AND student_id=$2',[req.auth.schoolId,r.studentId,r.gradeLevel,r.section]);
    if(r.action==='CREATE')created++;else updated++;
   }
   await c.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'STUDENT_BULK_IMPORT','student_import',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,require('crypto').randomUUID(),JSON.stringify({created,updated})]);
   await c.query('COMMIT');res.json({ok:true,created,updated,total:created+updated});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(e.statusCode|| (e.code==='23505'?409:500)).json({error:e.message||'Import failed. An LRN may already be registered.'});}finally{c.release();}
 });
 app.post('/api/students/batch',authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  const role=req.auth.role,isTeacher=role==='TEACHER',isDepartmentHead=role==='DEPARTMENT_HEAD';
  const ids=[...new Set((Array.isArray(req.body?.studentIds)?req.body.studentIds:[]).map(clean).filter(Boolean))],action=clean(req.body?.action).toUpperCase();
  if(!ids.length||ids.length>500||ids.some(x=>x.length>80)||!['ACTIVATE','DEACTIVATE','ARCHIVE','UPDATE','ASSIGN'].includes(action))return res.status(400).json({error:'Select 1–500 students and a valid action.'});
  if(isTeacher&&(!req.auth.teacherDesignations?.includes('CLASS_ADVISER')||!['UPDATE','ASSIGN'].includes(action)))return res.status(403).json({error:'Class Advisers may batch-edit or assign only students in their assigned sections.'});
  if(isDepartmentHead&&(!req.auth.departmentId||req.auth.departmentCode==='UNASSIGNED'||!['UPDATE','ASSIGN'].includes(action)))return res.status(403).json({error:'Department Heads may edit or assign only learners in their own department. Activation, deactivation, and archiving remain School Administrator actions.'});
  const b=req.body||{};
  if(action==='ASSIGN'&&(!validText(b.gradeLevel,40)||!validText(b.section,100)))return res.status(400).json({error:'Choose a valid grade and section.'});
  if(action==='UPDATE'&&b.fullName!=null&&!validText(b.fullName,200))return res.status(400).json({error:'Full name must contain 1–200 characters.'});
  if(b.sex!=null&&!['MALE','FEMALE'].includes(clean(b.sex).toUpperCase()))return res.status(400).json({error:'Sex must be Male or Female.'});
  if(b.lrn!=null&&clean(b.lrn).length>30)return res.status(400).json({error:'LRN must be 30 characters or fewer.'});
  if(b.parentName!=null&&clean(b.parentName).length>160)return res.status(400).json({error:'Parent name must be 160 characters or fewer.'});
  if(b.parentMobile!=null&&clean(b.parentMobile).length>30)return res.status(400).json({error:'Parent mobile must be 30 characters or fewer.'});
  if((isTeacher||isDepartmentHead)&&(b.lrn!=null||b.parentName!=null||b.parentMobile!=null))return res.status(403).json({error:'Only School Administrators may update LRN and guardian details.'});
  if(action==='UPDATE'&&![b.fullName,b.sex,b.lrn,b.parentName,b.parentMobile].some(v=>v!=null&&clean(v)))return res.status(400).json({error:'Provide at least one field to update.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   let found;
   if(isTeacher){
    found=await c.query(`SELECT s.student_id FROM students s
      LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
      WHERE s.school_id=$1 AND s.student_id=ANY($2::text[]) AND s.active=TRUE AND s.archived_at IS NULL
        AND EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=COALESCE(en.grade_level,s.grade_level) AND ca.section=COALESCE(en.section,s.section))
      FOR UPDATE OF s`,[req.auth.schoolId,ids,req.auth.userId]);
   }else if(isDepartmentHead){
    if(!req.auth.departmentId||req.auth.departmentCode==='UNASSIGNED')throw Object.assign(new Error('Your account must be assigned to a department.'),{statusCode:403});
    found=await c.query(`SELECT s.student_id FROM students s
      LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
      WHERE s.school_id=$1 AND s.student_id=ANY($2::text[]) AND s.active=TRUE AND s.archived_at IS NULL
        AND EXISTS(SELECT 1 FROM class_periods p WHERE p.school_id=s.school_id AND p.department_id=$3 AND p.active=TRUE
          AND p.grade_level=COALESCE(en.grade_level,s.grade_level)
          AND p.section IS NOT NULL AND TRIM(p.section)=COALESCE(en.section,s.section))
      FOR UPDATE OF s`,[req.auth.schoolId,ids,req.auth.departmentId]);
   }else{
    found=await c.query('SELECT student_id,active,archived_at FROM students WHERE school_id=$1 AND student_id=ANY($2::text[]) FOR UPDATE',[req.auth.schoolId,ids]);
   }
   if(found.rowCount!==ids.length||(!isTeacher&&!isDepartmentHead&&!['ACTIVATE','ARCHIVE'].includes(action)&&found.rows.some(x=>!x.active||x.archived_at))||(action==='ARCHIVE'&&found.rows.some(x=>x.archived_at))){
    await c.query('ROLLBACK');return res.status(409).json({error:'Some selected records are unavailable or outside your authorized scope. Refresh and try again.'});
   }
   if(action==='ASSIGN'){
    if(isTeacher){
     const dest=await c.query('SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4',[req.auth.schoolId,req.auth.userId,clean(b.gradeLevel),clean(b.section)]);
     if(!dest.rowCount){await c.query('ROLLBACK');return res.status(403).json({error:'You may assign students only to your own assigned advisory sections.'});}
    }else if(isDepartmentHead){
     const dest=await c.query(`SELECT 1 FROM class_periods WHERE school_id=$1 AND department_id=$2 AND active=TRUE AND grade_level=$3 AND section IS NOT NULL AND TRIM(section)=$4 LIMIT 1`,[req.auth.schoolId,req.auth.departmentId,clean(b.gradeLevel),clean(b.section)]);
     if(!dest.rowCount){await c.query('ROLLBACK');return res.status(403).json({error:'You may assign learners only to an active section in your department.'});}
    }
   }
   if(['ACTIVATE','DEACTIVATE','ARCHIVE'].includes(action)){
    const active=action==='ACTIVATE';
    await c.query('UPDATE students SET active=$3,archived_at=CASE WHEN $4 THEN NOW() WHEN $5 THEN NULL ELSE archived_at END,updated_at=NOW() WHERE school_id=$1 AND student_id=ANY($2::text[])',[req.auth.schoolId,ids,active,action==='ARCHIVE',active]);
    await c.query('UPDATE student_accounts SET active=$3,updated_at=NOW() WHERE school_id=$1 AND student_id=ANY($2::text[])',[req.auth.schoolId,ids,active]);
    if(!active)await c.query('UPDATE student_sessions SET revoked_at=NOW() WHERE school_id=$1 AND student_account_id IN (SELECT student_account_id FROM student_accounts WHERE school_id=$1 AND student_id=ANY($2::text[])) AND revoked_at IS NULL',[req.auth.schoolId,ids]);
   }else{
    if(isTeacher||isDepartmentHead){
     await c.query('UPDATE students SET full_name=COALESCE($3,full_name),sex=COALESCE($4,sex),updated_at=NOW() WHERE school_id=$1 AND student_id=ANY($2::text[])',[req.auth.schoolId,ids,b.fullName??null,b.sex?clean(b.sex).toUpperCase():null]);
    }else{
     await c.query('UPDATE students SET full_name=COALESCE($3,full_name),sex=COALESCE($4,sex),lrn=COALESCE($5,lrn),parent_name=COALESCE($6,parent_name),parent_mobile=COALESCE($7,parent_mobile),updated_at=NOW() WHERE school_id=$1 AND student_id=ANY($2::text[])',[req.auth.schoolId,ids,b.fullName??null,b.sex?clean(b.sex).toUpperCase():null,b.lrn??null,b.parentName??null,b.parentMobile??null]);
    }
    if(action==='ASSIGN'){
     const y=await c.query("SELECT school_year_id FROM school_years WHERE school_id=$1 AND status='ACTIVE' FOR SHARE",[req.auth.schoolId]);
     if(y.rowCount){
      for(const id of ids){
       const saved=await c.query(`INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'ENROLLED',$6)
        ON CONFLICT(school_id,student_id,school_year_id) DO UPDATE SET grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,updated_at=NOW()
        WHERE student_enrollments.enrollment_status='ENROLLED' RETURNING student_id`,[req.auth.schoolId,id,y.rows[0].school_year_id,b.gradeLevel,b.section,req.auth.userId]);
       if(!saved.rowCount)throw Object.assign(new Error('A selected learner has a closed or non-active enrollment. Historical enrollment was not changed.'),{statusCode:409});
      }
     }else{
      if(isTeacher||isDepartmentHead)throw Object.assign(new Error('An active school year is required before changing student placement.'),{statusCode:409});
      for(const id of ids)await c.query('UPDATE students SET grade_level=$3,section=$4,updated_at=NOW() WHERE school_id=$1 AND student_id=$2',[req.auth.schoolId,id,b.gradeLevel,b.section]);
     }
    }
   }
   await c.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'STUDENT_BULK_'||$3,'student_batch',$4,$5::jsonb)`,
     [req.auth.schoolId,req.auth.userId,action,require('crypto').randomUUID(),JSON.stringify({studentIds:ids,departmentId:isDepartmentHead?req.auth.departmentId:null})]);
   await c.query('COMMIT');res.json({ok:true,updated:ids.length,action});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});res.status(e.statusCode||(e.code==='23505'?409:500)).json({error:e.statusCode?e.message:e.code==='23505'?'An LRN is already assigned to another student.':'Could not complete batch action.'});}finally{c.release();}
 });
}
module.exports={registerStudentManagementRoutes};
