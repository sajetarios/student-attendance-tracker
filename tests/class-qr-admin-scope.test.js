'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {registerClassQrRoutes} = require('../class-qr-routes');
const sid='11111111-1111-4111-8111-111111111111';
const school='22222222-2222-4222-8222-222222222222';
const teacherId='33333333-3333-4333-8333-333333333333';
const adminId='44444444-4444-4444-8444-444444444444';

function harness() {
 const routes = new Map(),calls=[];
 const app = {
  get(route,...handlers){routes.set('GET '+route,handlers);},
  post(route,...handlers){routes.set('POST '+route,handlers);}
 };
 const client = {
  async query(sql,args) {
   calls.push({sql,args});
   if(sql.includes('FROM class_qr_sessions') && sql.includes('FOR UPDATE'))
    return {rowCount:1,rows:[{session_id:sid,period_id:sid,teacher_user_id:teacherId,school_date:'2026-11-19',closed_at:null}]};
   return {rowCount:1,rows:[]};
  },
  release(){calls.push({sql:'RELEASE'});}
 };
 const pool = {
  async query(sql,args) {
   calls.push({sql,args});
   if(sql.includes('FROM class_periods p'))return {rowCount:1,rows:[{
    period_id:sid,teacher_user_id:teacherId,section:'A',grade_level:'8',
    effective_subject:'English',effective_start:'08:00:00',effective_end:'09:00:00'
   }]};
   return {rowCount:0,rows:[]};
  },
  async connect(){return client;}
 };
 const auth=(req,res,next)=>next();
 const permissions=(...roles)=>(req,res,next)=>roles.includes(req.auth.role)
  ?next():res.status(403).json({error:'Access denied.'});
 registerClassQrRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolRoles:permissions});
 async function hit(method,route,role,overrides={}) {
  const handlers=routes.get(method+' '+route);
  assert.ok(handlers,'Route registered: '+route);
  const req={auth:{role,schoolId:school,userId:role==='TEACHER'?teacherId:adminId},
   body:{},params:{id:sid},query:{},...overrides};
  const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},
   status(code){this.statusCode=code;return this;},
   sendStatus(code){this.statusCode=code;return this;},
   json(data){this.body=data;return this;},
   end(){return this;}};
  for(const handler of handlers) {
   let nextCalled=false;
   await handler(req,res,()=>{nextCalled=true;});
   if(!nextCalled)break;
  }
  return res;
 }
 return {hit,calls};
}

test('School Admin cannot issue, view, manually mark or close teacher QR sessions',async()=>{
 const h=harness();
 for(const [method,route] of [
  ['POST','/api/class-qr/sessions'],
  ['GET','/api/class-qr/sessions/:id/qr'],
  ['POST','/api/class-qr/sessions/:id/manual'],
  ['POST','/api/class-qr/sessions/:id/close']
 ])assert.equal((await h.hit(method,route,'SCHOOL_ADMIN')).statusCode,403,route);
 assert.equal(h.calls.length,0,'No database access on denied class QR writes or reads');
});

test('Only an assigned teacher may start a QR session, regardless of role-check success',async()=>{
 const h=harness();
 const response=await h.hit('POST','/api/class-qr/sessions','TEACHER',{
  auth:{role:'TEACHER',schoolId:school,userId:'55555555-5555-4555-8555-555555555555'},
  body:{periodId:sid}
 });
 assert.equal(response.statusCode,403);
 assert.equal(h.calls.filter(call=>call.sql.includes('INSERT INTO class_qr_sessions')).length,0);
});

test('Admin monitor is read-only and school-scoped; teacher cannot query it',async()=>{
 const h=harness();
 assert.equal((await h.hit('GET','/api/class-qr/monitor','TEACHER')).statusCode,403);
 const res=await h.hit('GET','/api/class-qr/monitor','SCHOOL_ADMIN');
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.body.sessions,[]);
 assert.equal(res.headers['Cache-Control'],'no-store, private');
 const read=h.calls.find(call=>call.sql.includes('FROM class_qr_sessions s'));
 assert.ok(read);
 assert.equal(read.args[0],school);
 assert.match(read.sql,/WHERE s\.school_id=\$1/);
 assert.ok(!('secret' in res.body),'No QR signing secrets exposed');
});

test('Emergency admin close requires reason and records audit atomically without modifying attendance',async()=>{
 const h=harness();
 const route='/api/class-qr/admin-override/sessions/:id/close';
 assert.equal((await h.hit('POST',route,'TEACHER',{body:{reason:'Emergency operations disruption'}})).statusCode,403);
 assert.equal((await h.hit('POST',route,'SCHOOL_ADMIN',{body:{reason:'too short'}})).statusCode,400);
 assert.equal(h.calls.length,0);
 const res=await h.hit('POST',route,'SCHOOL_ADMIN',{body:{reason:'Classroom QR was exposed to an unauthorized group.'}});
 assert.equal(res.statusCode,200);
 assert.equal(res.body.ok,true);
 assert.ok(h.calls.some(call=>call.sql==='BEGIN'));
 assert.ok(h.calls.some(call=>call.sql==='COMMIT'));
 const close=h.calls.find(call=>call.sql.includes('UPDATE class_qr_sessions SET closed_at'));
 const audit=h.calls.find(call=>call.sql.includes('INSERT INTO audit_logs'));
 assert.ok(close&&audit);
 assert.deepEqual(close.args,[school,sid]);
 assert.equal(audit.args[0],school);
 assert.equal(audit.args[1],adminId);
 assert.equal(audit.args[2],sid);
 assert.equal(JSON.parse(audit.args[3]).reason,'Classroom QR was exposed to an unauthorized group.');
 assert.equal(h.calls.some(call=>call.sql.includes('INSERT INTO class_qr_checkins')),false);
});

test('Class QR portal UI hides teacher launch from Admin and exposes monitoring navigation',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../public/class-qr-dashboard-link.js'),'utf8');
 const teacherPage=fs.readFileSync(path.join(__dirname,'../public/class-qr-teacher.js'),'utf8');
 const monitorPage=fs.readFileSync(path.join(__dirname,'../public/class-qr-monitor.html'),'utf8');
 const monitorJs=fs.readFileSync(path.join(__dirname,'../public/class-qr-monitor.js'),'utf8');
 assert.match(script,/if \(user\.role === 'SCHOOL_ADMIN'\)/);
 assert.match(script,/href = '\/class-qr-monitor\.html'/);
 assert.match(script,/if \(user\.role !== 'TEACHER'\) return/);
 assert.doesNotMatch(script,/\['TEACHER', 'SCHOOL_ADMIN'\]/);
 assert.match(teacherPage,/user\?\.role!=='TEACHER'/);
 assert.match(monitorPage,/Class Attendance Monitoring/);
 assert.match(monitorJs,/user\?\.role !== 'SCHOOL_ADMIN'/);
 assert.match(monitorJs,/admin-override\/sessions\//);
});