'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const register=require('../cloud-sync-routes');

const schoolId='11111111-1111-4111-8111-111111111111';
const eventId='22222222-2222-4222-8222-222222222222';
const periodId='33333333-3333-4333-8333-333333333333';
const secret='cloud-receiver-signature-unique-to-test-school-1234';

function appRoutes() {
  const routes={get:new Map(),post:new Map(),put:new Map()};
  const app={
    get:(name,...fns)=>routes.get.set(name,fns),
    post:(name,...fns)=>routes.post.set(name,fns),
    put:(name,...fns)=>routes.put.set(name,fns)
  };
  return {app,routes};
}

function response() {
  return {
    statusCode:200,body:null,ended:false,
    status(code){this.statusCode=code;return this;},
    json(value){this.body=value;this.ended=true;return this;}
  };
}

async function dispatch(handlers,req) {
  const res=response();
  for(const fn of handlers) {
    if(res.ended)break;
    let next=false;
    await fn(req,res,()=>{next=true;});
    if(res.ended)break;
    if(fn.length>=3 && !next)break;
  }
  return res;
}

function signed(body) {
  const rawBody=Buffer.from(JSON.stringify(body));
  const stamp=String(Date.now()),nonce=crypto.randomUUID();
  const headers={
    'X-Cloud-Timestamp':stamp,'X-Cloud-Nonce':nonce,
    'X-Cloud-Signature':crypto.createHmac('sha256',secret)
      .update(stamp+'.'+nonce+'.').update(rawBody).digest('hex')
  };
  return {body,rawBody,get:name=>headers[name]||''};
}
function qrEvent(section='Rizal') {
  return {
    eventId,eventType:'TIME_IN',attendanceScope:'CLASS',
    schoolDate:'2026-11-16',occurredAt:'2026-11-16T00:00:00.000Z',
    student:{studentId:'STUDENT-001',fullName:'Historic Student Name',
      gradeLevel:'Grade 8',section},
    period:{periodName:'Period 1',subjectName:'English',startTime:'08:00',endTime:'09:00'}
  };
}
function fixture({student=null,priorEvent=null,period=true,finalized=false,actor=null}={}) {
  const queries=[],routes=appRoutes();
  const client={
    async query(sql,args=[]) {
      queries.push({sql,args});
      if(sql.includes('FROM schools WHERE lower(school_code)'))
        return {rowCount:1,rows:[{school_id:schoolId}]};
      if(sql.includes('FROM attendance_events WHERE event_id=$1'))
        return {rowCount:priorEvent?1:0,rows:priorEvent?[{school_id:priorEvent}]:[]};
      if(sql.includes('FROM students s') && sql.includes('s.archived_at IS NULL'))
        return {rowCount:student?1:0,rows:student?[student]:[]};
      if(sql.includes('FROM class_periods WHERE school_id=$1 AND period_name=$2'))
        return {rowCount:period?1:0,rows:period?[{period_id:periodId}]:[]};
      if(sql.includes('FROM class_attendance_finalizations WHERE school_id=$1'))
        return {rowCount:finalized?1:0,rows:finalized?[{}]:[]};
      if(sql.includes('INSERT INTO attendance_events('))
        return {rowCount:1,rows:[{event_id:eventId}]};
      if(sql.includes('SELECT user_id FROM school_users'))
        return {rowCount:actor?1:0,rows:actor?[{user_id:actor}]:[]};
      return {rowCount:0,rows:[]};
    },
    release(){}
  };
  const pool={connect:async()=>client,query:(sql,args)=>client.query(sql,args)};
  const authorize=(req,res,next)=>{
    if(req.auth?.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'School Admin only'});
    next();
  };
  register(routes.app,pool,{authenticateSchoolClient:(req,res,next)=>next(),requireSchoolAdmin:authorize});
  return {routes:routes.routes,queries};
}

async function withSecret(fn) {
  const previous=process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;
  process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON=JSON.stringify({SCHOOL001:secret});
  try{return await fn();}
  finally{
    if(previous===undefined)delete process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;
    else process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON=previous;
  }
}

test('cloud QR receive refuses unknown learners without creating master records',async()=>withSecret(async()=>{
  const h=fixture();
  const res=await dispatch(h.routes.post.get('/api/cloud-sync/receive'),
    signed({schoolCode:'SCHOOL001',events:[qrEvent()]}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.results[0].status,'REJECTED');
  assert.match(res.body.results[0].reason,/Learner is missing/);
  assert.ok(h.queries.some(q=>q.sql.includes('s.archived_at IS NULL')));
  assert.ok(!h.queries.some(q=>/INSERT INTO students|UPDATE students|INSERT INTO attendance_events/.test(q.sql)));
  assert.ok(h.queries.some(q=>q.sql==='COMMIT'), 'Nonce should be committed with reviewed QR outcome');
}));

test('cloud QR receive quarantines stale section even when student ID exists',async()=>withSecret(async()=>{
  const h=fixture({student:{student_id:'STUDENT-001',current_enrollment:true,
    grade_level:'Grade 8',section:'Rizal'}});
  const res=await dispatch(h.routes.post.get('/api/cloud-sync/receive'),
    signed({schoolCode:'SCHOOL001',events:[qrEvent('Bonifacio')]}));
  assert.equal(res.body.results[0].status,'REJECTED');
  assert.match(res.body.results[0].reason,/Cloud learner enrollment differs/);
  assert.ok(!h.queries.some(q=>/INSERT INTO attendance_events/.test(q.sql)));
}));

test('cloud QR receive accepts an exact active class and still enforces finalization',async()=>withSecret(async()=>{
  const student={student_id:'STUDENT-001',current_enrollment:true,
    grade_level:'Grade 8',section:'Rizal'};
  const good=fixture({student});
  const accepted=await dispatch(good.routes.post.get('/api/cloud-sync/receive'),
    signed({schoolCode:'SCHOOL001',events:[qrEvent()]}));
  assert.equal(accepted.body.results[0].status,'ACCEPTED');
  const saved=good.queries.find(q=>q.sql.includes('INSERT INTO attendance_events('));
  assert.equal(saved.args[5],periodId);
  assert.equal(saved.args[3],'STUDENT-001');
  const locked=fixture({student,finalized:true});
  const rejected=await dispatch(locked.routes.post.get('/api/cloud-sync/receive'),
    signed({schoolCode:'SCHOOL001',events:[qrEvent()]}));
  assert.equal(rejected.body.results[0].status,'REJECTED');
  assert.match(rejected.body.results[0].reason,/finalized/);
  assert.ok(!locked.queries.some(q=>q.sql.includes('INSERT INTO attendance_events(')));
}));

test('cloud QR receiver acknowledges replay without creating or editing student master',async()=>withSecret(async()=>{
  const h=fixture({priorEvent:schoolId});
  const res=await dispatch(h.routes.post.get('/api/cloud-sync/receive'),
    signed({schoolCode:'SCHOOL001',events:[qrEvent()]}));
  assert.equal(res.body.results[0].status,'ALREADY_SYNCED');
  assert.ok(!h.queries.some(q=>q.sql.includes('FROM students s')));
}));

test('cloud status and review endpoints enforce School Admin access, including Department Head',async()=>{
  const h=fixture();
  const statusRoute=h.routes.get.get('/api/cloud-sync/status');
  const reviewRoute=h.routes.get.get('/api/cloud-sync/review');
  const retryRoute=h.routes.post.get('/api/cloud-sync/retry');
  for(const role of ['TEACHER','DEPARTMENT_HEAD','GATE_KEEPER']) {
    for(const handlers of [statusRoute,reviewRoute,retryRoute]){
      const res=await dispatch(handlers,{auth:{type:'SCHOOL_USER',role,schoolId},body:{}});
      assert.equal(res.statusCode,403,role+' must not see/mutate school-wide cloud records');
    }
  }
  assert.equal(statusRoute[1].length,3,'Status must require the same admin middleware as cloud settings');
});

test('typed cloud review retains a consumed signature nonce and rolls back partial marks',async()=>withSecret(async()=>{
  const h=fixture({actor:null});
  const operation={
    operationId:eventId,type:'MANUAL_MARKS',date:'2026-11-16',
    actorUsername:'not-on-cloud',
    period:{periodName:'Period 1',gradeLevel:'Grade 8',section:'Rizal',
      subjectName:'English',startTime:'08:00',endTime:'09:00'},
    marks:[{studentId:'STUDENT-001',status:'PRESENT',note:'',expectedRevision:0,revision:1}]
  };
  const res=await dispatch(h.routes.post.get('/api/cloud-sync/receive-operations'),
    signed({schoolCode:'SCHOOL001',operation}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.results[0].status,'NEEDS_REVIEW');
  assert.equal(res.body.results[0].code,'ACTOR_MAPPING');
  const statements=h.queries.map(q=>q.sql);
  assert.ok(statements.includes('SAVEPOINT cloud_apply'));
  assert.ok(statements.includes('ROLLBACK TO SAVEPOINT cloud_apply'));
  assert.ok(statements.includes('COMMIT'));
  assert.ok(!statements.includes('ROLLBACK'),'Expected logical conflict to keep used nonce');
}));
