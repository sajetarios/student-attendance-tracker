'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {registerShsRoutes,gradesForMode,defaultCurriculum}=require('../shs-academic-routes');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const SCHOOL='11111111-1111-4111-8111-111111111111',ADMIN='22222222-2222-4222-8222-222222222222';
const YEAR='33333333-3333-4333-8333-333333333333',ENROLLMENT='44444444-4444-4444-8444-444444444444';
const baseAuth=(role='SCHOOL_ADMIN')=>({type:'SCHOOL_USER',role,schoolId:SCHOOL,userId:ADMIN});
function harness({mode='JHS_ONLY',recordCount=0,yearLabel='2026-2027',enrollmentGrade='Grade 12',curriculum=null}={}){
 const routes=new Map(),queries=[],transaction=[];
 const database={
  async query(sql,params=[]){
   queries.push({sql,params});if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){transaction.push(sql);return{rows:[],rowCount:0};}
   if(sql.includes('FROM school_academic_levels WHERE'))return{rows:[{level_mode:mode}],rowCount:1};
   if(sql.includes('FROM school_years WHERE school_id=$1 AND school_year_id=$2'))return{rows:[{school_year_id:YEAR,school_year_label:yearLabel,status:'ACTIVE'}],rowCount:1};
   if(sql.includes('FROM school_years WHERE school_id=$1 ORDER BY'))return{rows:[{schoolYearId:YEAR,label:yearLabel,status:'ACTIVE'}],rowCount:1};
   if(sql.includes('FROM shs_year_curricula WHERE school_id=$1 AND school_year_id=$2'))return{rows:curriculum?[{curriculum_version:curriculum}]:[],rowCount:curriculum?1:0};
   if(sql.includes('FROM shs_year_curricula WHERE school_id=$1'))return{rows:[],rowCount:0};
   if(sql.includes(')::integer AS total'))return{rows:[{total:recordCount}],rowCount:1};
   if(sql.includes('FROM student_enrollments e')&&sql.includes('WHERE e.school_id=$1 AND e.enrollment_id=$2'))
    return{rows:[{grade_level:enrollmentGrade,school_year_id:YEAR,school_year_label:yearLabel}],rowCount:1};
   if(sql.includes('FROM student_enrollments e')&&sql.includes('WHERE e.school_id=$1 AND e.school_year_id=$2'))
    return{rows:[],rowCount:0};
   return{rows:[],rowCount:1};
  },
  release(){}
 };
 const pool={query:database.query,connect:async()=>database};
 function auth(req,res,next){if(req.auth?.type!=='SCHOOL_USER')return res.status(401).json({error:'School account required'});next();}
 function allowed(...roles){return(req,res,next)=>{if(!roles.includes(req.auth?.role))return res.status(403).json({error:'Role denied'});next();};}
 const app={get:(p,...handlers)=>routes.set('GET '+p,handlers),put:(p,...handlers)=>routes.set('PUT '+p,handlers)};
 registerShsRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolRoles:allowed});
 async function call(method,route,{authInfo=baseAuth(),body={},query={},params={}}={}){
  const handlers=routes.get(method+' '+route);assert.ok(handlers,'Route registered '+method+' '+route);
  const req={auth:authInfo,body,query,params},res={
   statusCode:200,body:null,headers:{},set(k,v){this.headers[k]=v;return this;},
   status(code){this.statusCode=code;return this;},json(data){this.body=data;return this;}
  };
  for(const handler of handlers){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}
  return {status:res.statusCode,body:res.body,headers:res.headers};
 }
 return{call,queries,transaction};
}
test('Academic level modes have exact grade choices with no extra levels',()=>{
 assert.deepEqual(gradesForMode('JHS_ONLY'),['Grade 7','Grade 8','Grade 9','Grade 10']);
 assert.deepEqual(gradesForMode('SHS_ONLY'),['Grade 11','Grade 12']);
 assert.equal(gradesForMode('INTEGRATED').length,6);
 assert.equal(defaultCurriculum('Grade 11','2026-2027'),'STRENGTHENED');
 assert.equal(defaultCurriculum('Grade 12','2026-2027'),'LEGACY');
});
test('Protected grade choices exclude Gatekeeper and any cross-role unsigned requests',async()=>{
 const h=harness();
 assert.equal((await h.call('GET','/api/shs/config',{authInfo:baseAuth('GATE_KEEPER')})).status,403);
 assert.equal((await h.call('PUT','/api/shs/config',{authInfo:baseAuth('TEACHER'),body:{mode:'INTEGRATED'}})).status,403);
 const d=await h.call('GET','/api/shs/config',{authInfo:baseAuth('DEPARTMENT_HEAD')});
 assert.equal(d.status,200);
 assert.deepEqual(d.body.allowedGrades,gradesForMode('JHS_ONLY'));
 assert.equal(d.headers['Cache-Control'],'no-store, private');
});
test('JHS-only school cannot be switched to an incompatible level when grades have records',async()=>{
 const h=harness({recordCount:3});
 const result=await h.call('PUT','/api/shs/config',{body:{mode:'SHS_ONLY'}});
 assert.equal(result.status,409);
 assert.equal(h.queries.some(q=>q.sql.includes('INSERT INTO school_academic_levels')),false);
 assert.ok(h.transaction.includes('ROLLBACK'));
});
test('School Admin may enable integrated JHS/SHS without touching existing student rows',async()=>{
 const h=harness();
 const result=await h.call('PUT','/api/shs/config',{body:{mode:'INTEGRATED'}});
 assert.equal(result.status,200);
 assert.equal(result.body.allowedGrades.length,6);
 assert.ok(h.queries.some(q=>q.sql.includes('SCHOOL_ACADEMIC_LEVELS_CHANGED')));
 assert.equal(h.queries.some(q=>q.sql.includes('UPDATE students')),false);
 assert.ok(h.transaction.includes('COMMIT'));
});
test('School Admin cannot configure SHS curriculum until SHS is enabled',async()=>{
 const h=harness();
 const result=await h.call('PUT','/api/shs/curriculum',{body:{schoolYearId:YEAR,gradeLevel:'Grade 11',version:'STRENGTHENED'}});
 assert.equal(result.status,409);
});
test('Grade 11 in SY 2026–2027 rejects legacy curriculum; Grade 12 pilot needs confirmation',async()=>{
 const h=harness({mode:'INTEGRATED'});
 const base={schoolYearId:YEAR,gradeLevel:'Grade 11',version:'LEGACY'};
 assert.equal((await h.call('PUT','/api/shs/curriculum',{body:base})).status,409);
 assert.equal((await h.call('PUT','/api/shs/curriculum',{body:{...base,gradeLevel:'Grade 12',version:'STRENGTHENED'}})).status,409);
 const accepted=await h.call('PUT','/api/shs/curriculum',{body:{...base,gradeLevel:'Grade 12',version:'STRENGTHENED',pilotConfirmed:true}});
 assert.equal(accepted.status,200);
 assert.equal(accepted.body.pilotConfirmed,true);
 assert.ok(h.queries.some(q=>q.sql.includes('SHS_CURRICULUM_SET')));
});
test('SHS learner pathway validation never accepts a track inconsistent with the grade/year curriculum',async()=>{
 const h=harness({mode:'INTEGRATED',curriculum:'LEGACY'});
 const bad=await h.call('PUT','/api/shs/enrollment-paths/:id',{params:{id:ENROLLMENT},body:{track:'TECHPRO',strand:''}});
 assert.equal(bad.status,409);
 const okay=await h.call('PUT','/api/shs/enrollment-paths/:id',{params:{id:ENROLLMENT},body:{track:'ACADEMIC',strand:'STEM'}});
 assert.equal(okay.status,200);
 assert.ok(h.queries.some(q=>q.sql.includes('SHS_LEARNER_PATH_SET')));
});
test('SHS learner paths cannot be changed by teachers or Department Heads',async()=>{
 const h=harness({mode:'INTEGRATED'});
 for(const role of ['TEACHER','DEPARTMENT_HEAD','GATE_KEEPER']){
  const reply=await h.call('PUT','/api/shs/enrollment-paths/:id',
   {authInfo:baseAuth(role),params:{id:ENROLLMENT},body:{track:'ACADEMIC'}});
  assert.equal(reply.status,403);
 }
});
test('Grade 11–12 selectors, staff privacy and Grade 12 pilot confirmation are present',()=>{
 const portal=read('public/portal.html'),script=read('public/shs-school-ui.js'),sw=read('public/sw.js');
 const sql=read('migrations/066_school_shs_levels_and_curriculum.sql');
 for(const id of ['newGrade','editGrade','batchGrade','bulkQrGrade','periodGrade','adviserNewSectionGrade','academicEnrollmentGrade'])
  assert.match(portal,new RegExp('id="'+id+'"'));
 for(const id of ['shsSchoolLevelMode','shsCurriculumForm','shsLearnerPathForm','shsGrade12PilotConfirmed'])
  assert.match(portal,new RegExp('id="'+id+'"'));
 for(const asset of ['/shs-school-ui.js?v=1','/shs-school-ui.css?v=1']){
  assert.ok(portal.includes(asset),'Portal loads '+asset);
  assert.ok(sw.includes(JSON.stringify(asset)),'PWA must cache '+asset);
 }
 assert.match(script,/attendigoStaffIdentity/);
 assert.match(script,/if\(user\.role!=='SCHOOL_ADMIN'\)return/);
 assert.match(script,/identity\.role!=='SCHOOL_ADMIN'/);
 assert.match(sql,/enforce_school_grade_offering/);
 for(const table of ['students','student_enrollments','class_periods','school_sections','class_adviser_assignments'])
  assert.match(sql,new RegExp('ON '+table+'\\b'));
});
