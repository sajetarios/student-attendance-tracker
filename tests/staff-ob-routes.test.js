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
 assert.ok(f.queries.some(x=>x.params?.includes('STAFF_OB_SUBMITTED')));
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
 assert.ok(head.queries.some(x=>x.params?.includes('STAFF_OB_RECOMMENDED')));
 assert.equal((await fixture('TEACHER').call('POST',path,{decision:'RECOMMEND'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,403);
 const admin=fixture('SCHOOL_ADMIN');
 const final='/api/staff-attendance/official-business/:id/decide';
 assert.equal((await admin.call('POST',final,{decision:'APPROVE'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,200);
 assert.match(admin.queries.find(x=>x.sql.includes('UPDATE staff_official_business_requests')).sql,/status='PENDING_ADMIN'/);
 assert.ok(admin.queries.some(x=>x.params?.includes('STAFF_OB_APPROVED')));
 assert.equal((await head.call('POST',final,{decision:'APPROVE'},{id:'a6831ee2-24db-42b2-9d27-39d130eb11f1'})).code,403);
});
test('approval flags only active weekday classes whose actual class times overlap OB',async()=>{
 const admin=fixture('SCHOOL_ADMIN');
 const id='a6831ee2-24db-42b2-9d27-39d130eb11f1';
 assert.equal((await admin.call('POST','/api/staff-attendance/official-business/:id/decide',
  {decision:'APPROVE'},{id})).code,200);
 const query=admin.queries.find(x=>x.sql.includes('INSERT INTO staff_ob_class_coverage'));
 assert.ok(query,'approval writes affected-class coverage in same transaction');
 assert.match(query.sql,/teacher_period_assignments ta/);
 assert.match(query.sql,/ta.teacher_user_id=ob.staff_user_id/);
 assert.match(query.sql,/class_period_days w/);
 assert.match(query.sql,/EXTRACT\(DOW FROM days.class_date\)/);
 assert.match(query.sql,/AT TIME ZONE 'Asia\/Manila'/);
 assert.match(query.sql,/p.active=TRUE/);
 assert.match(query.sql,/ON CONFLICT\(school_id,request_id,period_id,class_date\) DO NOTHING/);
 assert.deepEqual(query.params,['s1',id]);
 assert.ok(admin.queries.some(x=>x.params?.includes('STAFF_OB_AFFECTED_CLASSES_FLAGGED')));
 const rejected=fixture('SCHOOL_ADMIN');
 await rejected.call('POST','/api/staff-attendance/official-business/:id/decide',
  {decision:'REJECT'},{id});
 assert.ok(!rejected.queries.some(x=>x.sql.includes('INSERT INTO staff_ob_class_coverage')),
  'rejected OB never flags classes');
});
test('coverage list restricts records to school, requesting staff and department',async()=>{
 const id='a6831ee2-24db-42b2-9d27-39d130eb11f1';
 const teacher=fixture('TEACHER');
 assert.equal((await teacher.call('GET','/api/staff-attendance/official-business/:id/coverage',{}, {id})).code,200);
 const query=teacher.queries[0];
 assert.match(query.sql,/c.school_id=\$1 AND c.request_id=\$2/);
 assert.match(query.sql,/o.department_id=\$4/);
 assert.match(query.sql,/o.staff_user_id=\$5/);
 assert.deepEqual(query.params,['s1',id,'TEACHER','d1','u1']);
 assert.equal((await fixture('STUDENT').call('GET','/api/staff-attendance/official-business/:id/coverage',{}, {id})).code,403);
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
