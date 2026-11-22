'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerStaffLeaveRoutes}=require('../staff-leave-routes');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

function harness(){
 const handlers=new Map(),queries=[];
 const pool={query:async (sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('FROM staff_leave_credit_entries e JOIN school_users u'))
   return {rows:[{entryId:'11111111-1111-4111-8111-111111111111',staffUserId:'00000000-0000-4000-8000-000000000001',staffName:'Simulated Administrator'}],rowCount:1};
  return {rows:[],rowCount:0};
 }};
 const app={get:(p,...f)=>handlers.set('GET '+p,f.at(-1)),
  post:(p,...f)=>handlers.set('POST '+p,f.at(-1))};
 registerStaffLeaveRoutes(app,pool,{authenticateSchoolClient:()=>{},
  requireSchoolRoles:()=>()=>{}});
 const invoke=async(path,role,userId='00000000-0000-4000-8000-000000000002')=>{
  const req={auth:{role,userId,schoolId:'00000000-0000-4000-8000-000000000003'},query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this;},
   json(v){this.body=v;return this;}};
  await handlers.get('GET '+path)(req,res);
  return res;
 };
 return {invoke,queries};
}
test('teacher cannot read anyone else’s pending credit certification queue',async()=>{
 const h=harness(),res=await h.invoke('/api/staff-leave/credits/pending','TEACHER');
 assert.equal(res.statusCode,403);
 assert.equal(h.queries.length,0);
});
test('Department Head review queue is restricted to other school administrators',async()=>{
 const h=harness(),res=await h.invoke('/api/staff-leave/credits/pending','DEPARTMENT_HEAD');
 assert.equal(res.statusCode,200);
 assert.equal(res.body.entries.length,1);
 const q=h.queries.at(-1);
 assert.match(q.sql,/e\.staff_user_id<>\$2/);
 assert.match(q.sql,/u\.role='SCHOOL_ADMIN'/);
 assert.deepEqual(q.params,[
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000002','DEPARTMENT_HEAD'
 ]);
});
test('School Admin can review other employees, not their own credit proposals',async()=>{
 const h=harness(),res=await h.invoke('/api/staff-leave/credits/pending','SCHOOL_ADMIN');
 assert.equal(res.statusCode,200);
 assert.match(h.queries.at(-1).sql,/e\.staff_user_id<>\$2/);
 assert.equal(h.queries.at(-1).params[2],'SCHOOL_ADMIN');
});
test('certified balance state is explicit, never a fabricated 0.000',async()=>{
 const h=harness(),res=await h.invoke('/api/staff-leave/credits','TEACHER');
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.body.balances,[]);
 assert.match(h.queries.at(-1).sql,/COUNT\(\*\) FILTER\(WHERE status='VERIFIED'\)>0 AS "isCertified"/);
 const ui=read('public/staff-leave-ui.js');
 assert.match(ui,/verified\?\(credits\.get\(key\)\|\|0\)\.toFixed\(3\):'Not recorded'/);
 assert.match(ui,/No HR-certified balance on file/);
});
test('only School Admin receives staff balance directory and opening import',()=>{
 const ui=read('public/staff-leave-ui.js'),routes=read('staff-leave-routes.js');
 assert.match(ui,/if\(user\.role==='SCHOOL_ADMIN'\)/);
 assert.match(ui,/Staff certified credit directory/);
 assert.match(ui,/if\(isHrAdmin\)/);
 assert.match(routes,/School HR authorization required/);
 assert.match(routes,/wanted!==req\.auth\.userId&&req\.auth\.role!=='SCHOOL_ADMIN'/);
 assert.match(routes,/req\.auth\.userId===e\.staff_user_id/);
 assert.match(routes,/document_kind IN \('SPECIAL_ORDER','CERTIFICATION'\)/);
});
test('teacher can claim proposed credits only; real certification needs different officer and evidence',()=>{
 const routes=read('staff-leave-routes.js');
 assert.match(routes,/\\'PROPOSED\\'/);
 assert.match(routes,/A separate authorized verifier is required/);
 assert.match(routes,/Attach the signed Special Order or official HR credit certification/);
 assert.match(routes,/LEAVE_CREDIT_CERTIFIED/);
});
test('CSC Form 6 blank worksheet is available before filing, but request details still require authorization',()=>{
 const ui=read('public/staff-leave-ui.js'),print=read('public/leave-form6.js');
 assert.match(ui,/leave-form6\.html\?template=1/);
 assert.match(ui,/Print prefilled CSC Form No\. 6/);
 assert.match(print,/params\.get\('template'\)==='1'/);
 assert.ok(print.indexOf("params.get('template')==='1'") <
  print.indexOf("if(!/^[a-f0-9-]{36}$/i.test(id)||!token)"));
 assert.match(print,/\/api\/staff-leave\/requests\/.*\/form6/);
 assert.match(read('public/leave-form6.html'),/Revised 2020/);
});
test('leave changes do not write gate punches or bypass school approval',()=>{
 const routes=read('staff-leave-routes.js');
 assert.doesNotMatch(routes,/INSERT INTO staff_attendance_events/i);
 assert.doesNotMatch(routes,/UPDATE staff_attendance_events/i);
 assert.doesNotMatch(routes,/INSERT INTO teacher_gate_events/i);
 assert.match(routes,/LEAVE_EXTERNAL_APPROVED/);
 assert.match(routes,/staff_form48_approved_leaves/);
});
