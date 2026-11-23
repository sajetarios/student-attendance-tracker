'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {rangeStart,registerPrincipalInsightsRoutes}=require('../principal-insights-routes');
const uuid='11111111-1111-4111-8111-111111111111';
function fixture({role='SCHOOL_ADMIN',departmentId='',deptFound=true}={}){
 const routes=new Map(),queries=[];
 const app={get(path,...handlers){routes.set(path,handlers);}};
 const authorize=(...roles)=>(req,res,next)=>
   roles.includes(req.auth.role)?next():res.status(403).json({error:'Forbidden'});
 const pool={async query(sql,args){
  queries.push({sql,args});
  if(sql.includes('SELECT 1 FROM school_departments'))
   return {rowCount:deptFound?1:0,rows:deptFound?[{}]:[]};
  if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:8}]};
  if(sql.includes('AS staff_with_verified'))return {rows:[{verified:12,pending:2,staff_with_verified:5,staff_with_pending:1}]};
  if(sql.includes('AS learner_days'))return {rows:[{scans:16,learner_days:14,unique_learners:11}]};
  if(sql.includes("status='PENDING_EXTERNAL'"))return {rows:[{head:2,school:3,official:1}]};
  if(sql.includes('FROM staff_official_business_requests'))return {rows:[{head:1,school:2}]};
  if(sql.includes('d.department_name AS name'))return {rows:[{departmentId:uuid,name:'English',staff:3,verified:8,pending:1}]};
  if(sql.includes('generate_series'))return {rows:[{date:'2026-11-23',verified:12}]};
  if(sql.includes('e.event_id AS "eventId"'))return {rows:[{eventId:uuid,staffName:'Sample Teacher',slot:'AM_OUT',date:'2026-11-23',department:'English'}]};
  throw Error('Unexpected query in test: '+sql);
 }};
 registerPrincipalInsightsRoutes(app,pool,{
  authenticateSchoolClient:(req,res,next)=>next(),
  requireSchoolRoles:authorize
 });
 const req={auth:{schoolId:'school-a',userId:'admin-1',role},query:{days:7,...(departmentId?{departmentId}:{})}};
 const res={code:200,headers:{},status(code){this.code=code;return this;},
   set(k,v){this.headers[k]=v;return this;},json(value){this.body=value;return this;}};
 async function call(){
  const fns=routes.get('/api/principal/insights');
  let i=0;
  async function next(){const f=fns[i++];return f?f(req,res,next):undefined;}
  await next();return res;
 }
 return {req,res,queries,call};
}
test('date range starts exactly 1, 7 or 30 Philippine school days before the end',()=>{
 assert.equal(rangeStart('2026-11-23',1),'2026-11-23');
 assert.equal(rangeStart('2026-11-23',7),'2026-11-17');
 assert.equal(rangeStart('2026-11-23',30),'2026-10-25');
});
test('only School Admin may access preview; no database reads for unauthorized actors',async()=>{
 const f=fixture({role:'TEACHER'}),response=await f.call();
 assert.equal(response.code,403);
 assert.equal(f.queries.length,0);
});
test('invalid date periods and foreign departments fail safely',async()=>{
 const f=fixture();f.req.query.days='365';
 assert.equal((await f.call()).code,400);
 assert.equal(f.queries.length,0);
 const invalid=fixture();invalid.req.query.departmentId='malformed';
 assert.equal((await invalid.call()).code,400);
 const otherSchool=fixture({departmentId:uuid,deptFound:false});
 assert.equal((await otherSchool.call()).code,404);
 assert.ok(otherSchool.queries.every(x=>x.args[0]==='school-a'));
});
test('verified, pending, and scan activity remain distinct without fabricated absence rates',async()=>{
 const f=fixture(),res=await f.call();
 assert.equal(res.code,200);
 assert.equal(res.headers['Cache-Control'],'no-store, private');
 assert.equal(res.body.scope,'SCHOOL_ADMIN_READ_ONLY_PREVIEW');
 assert.equal(res.body.staff.verifiedSlots,12);
 assert.equal(res.body.staff.pendingSlots,2);
 assert.equal(res.body.staff.staffWithVerifiedSlot,5);
 assert.equal(res.body.students.uniqueLearnersScanned,11);
 assert.equal(res.body.students.scope,'SCHOOL_WIDE_ONLY');
 assert.equal(res.body.approvals.leave.official,1);
 assert.equal(res.body.approvals.ob.school,2);
 assert.ok(res.body.definitions.students.includes('do not prove absence'));
 assert.equal(res.body.departments[0].name,'English');
 assert.ok(f.queries.every(x=>x.args[0]==='school-a'));
 assert.equal(f.queries.length,8);
 assert.ok(f.queries.some(x=>x.sql.includes("verification_status='VERIFIED'")));
 assert.ok(!f.queries.some(x=>/UPDATE |DELETE |INSERT /i.test(x.sql)));
 const student=f.queries.find(x=>x.sql.includes('AS learner_days'));
 assert.equal(student.args.length,3);
 const departments=f.queries.find(x=>x.sql.includes('d.department_name AS name'));
 assert.equal(departments.args.length,3);
});
test('department selection scopes staff, leave, OB and verification without mis-scoping learner scans',async()=>{
 const f=fixture({departmentId:uuid}),res=await f.call();
 assert.equal(res.code,200);
 assert.equal(res.body.departmentId,uuid);
 assert.ok(f.queries.filter(x=>x.sql.includes('$4::uuid')).every(x=>x.args[3]===uuid));
 assert.equal(f.queries.find(x=>x.sql.includes('AS learner_days')).args.length,3);
});
