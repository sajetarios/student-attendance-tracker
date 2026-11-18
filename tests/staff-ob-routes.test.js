'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerStaffObRoutes}=require('../staff-ob-routes');
const code=fs.readFileSync('staff-ob-routes.js','utf8');
const schema=fs.readFileSync('migrations/051_staff_smart_attendance_foundation.sql','utf8');
function fixture(role='TEACHER',departmentId='d1'){
 const handlers=new Map(),queries=[],auth={type:'SCHOOL_USER',schoolId:'s1',userId:'u1',role,departmentId};
 const db={query:async(sql,params)=>{queries.push({sql,params});return {rowCount:1,rows:[{request_id:'id1',status:sql.includes('PENDING_ADMIN')?'APPROVED':'PENDING_ADMIN'}]};},
  release(){}};
 const pool={query:db.query,connect:async()=>db};
 registerStaffObRoutes({get:(p,...h)=>handlers.set('GET '+p,h),post:(p,...h)=>handlers.set('POST '+p,h)},pool,
 {authenticateSchoolClient:(req,res,next)=>next(),
  requireSchoolRoles:(...roles)=>(req,res,next)=>roles.includes(req.auth.role)?next():res.status(403).json({error:'Denied'})});
 async function call(method,path,body={},params={}){
  const req={auth,body,params,query:{}};
  const res={code:200,headers:{},set(k,v){this.headers[k]=v;return this;},
   status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
  const list=handlers.get(method+' '+path);assert.ok(list,'route '+method+' '+path);
  for(let i=0;i<list.length;i++){
   if(res.body)break;
   await new Promise((resolve,reject)=>{
    try{
     let advanced=false;
     const result=list[i](req,res,()=>{advanced=true;resolve();});
     Promise.resolve(result).then(()=>{if(!advanced)resolve();},reject);
    }catch(e){reject(e);}
   });
  }
  return res;
 }
 return {call,queries,auth};
}
test('only staff roles may access OB routes and all reads are school scoped',async()=>{
 const f=fixture('TEACHER');
 const r=await f.call('GET','/api/staff-attendance/official-business');
 assert.equal(r.code,200);
 assert.match(f.queries[0].sql,/o.school_id=\$1 AND o.staff_user_id=\$2/);
 assert.deepEqual(f.queries[0].params,['s1','u1']);
 const head=fixture('DEPARTMENT_HEAD','dept1');
 await head.call('GET','/api/staff-attendance/official-business');
 assert.match(head.queries[0].sql,/o.department_id=\$2/);
 assert.deepEqual(head.queries[0].params,['s1','dept1']);
 const admin=fixture('SCHOOL_ADMIN');
 await admin.call('GET','/api/staff-attendance/official-business');
 assert.deepEqual(admin.queries[0].params,['s1']);
 const student=fixture('STUDENT');
 assert.equal((await student.call('GET','/api/staff-attendance/official-business')).code,403);
});
test('submission requires valid dates, purpose, destination and a department',async()=>{
 const f=fixture();
 assert.equal((await f.call('POST','/api/staff-attendance/official-business',{purpose:'x',destination:'y'})).code,400);
 assert.equal((await f.call('POST','/api/staff-attendance/official-business',{
  purpose:'Official seminar',destination:'District Office',startsAt:'2026-12-02T08:00:00+08:00',
  endsAt:'2026-12-02T17:00:00+08:00'})).code,201);
 assert.ok(f.queries.some(x=>x.sql.includes('STAFF_OB_SUBMITTED')));
 assert.ok(f.queries.some(x=>x.sql.includes('COMMIT')));
 const noDep=fixture('TEACHER',null);
 assert.equal((await noDep.call('POST','/api/staff-attendance/official-business',{
  purpose:'Official seminar',destination:'District Office',startsAt:'2026-12-02T08:00:00+08:00',
  endsAt:'2026-12-02T17:00:00+08:00'})).code,403);
});
test('department head recommendation and school admin final approval are distinct',async()=>{
 const path='/api/staff-attendance/official-business/:id/recommend';
 const head=fixture('DEPARTMENT_HEAD','dept1');
 assert.equal((await head.call('POST',path,{decision:'RECOMMEND'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,200);
 const sql=head.queries.find(x=>x.sql.includes('UPDATE staff_official_business_requests'));
 assert.match(sql.sql,/o.department_id=\$3/);
 assert.match(sql.sql,/o.staff_user_id<>\$4/);
 assert.match(sql.sql,/o.status='PENDING_HEAD'/);
 assert.ok(head.queries.some(x=>x.sql.includes('STAFF_OB_RECOMMENDED')));
 assert.equal((await fixture('TEACHER').call('POST',path,{decision:'RECOMMEND'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,403);
 const admin=fixture('SCHOOL_ADMIN');
 const final='/api/staff-attendance/official-business/:id/decide';
 assert.equal((await admin.call('POST',final,{decision:'APPROVE'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,200);
 assert.match(admin.queries.find(x=>x.sql.includes('UPDATE staff_official_business_requests')).sql,/status='PENDING_ADMIN'/);
 assert.ok(admin.queries.some(x=>x.sql.includes('STAFF_OB_APPROVED')));
 assert.equal((await head.call('POST',final,{decision:'APPROVE'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,403);
});
test('schema enforces immutable audit, department FKs, status transitions and approval identity',()=>{
 for(const token of ['PENDING_HEAD','PENDING_ADMIN','APPROVED','REJECTED','CANCELLED',
  'staff_attendance_audit_immutable','staff_ob_class_coverage','staff_official_business_requests',
  'head_decided_at','admin_decided_at'])assert.ok(schema.includes(token),token);
 assert.match(code,/BEGIN/);
 assert.match(code,/ROLLBACK/);
 assert.match(code,/COMMIT/);
 assert.match(code,/staff_user_id<>\$3/);
});
