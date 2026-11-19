'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {registerGateOfflineRoutes}=require('../gate-offline-routes');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function harness({existing=null,subject=null}={}){
 const routes=new Map(),queries=[];
 const app={
  get:(route,...handlers)=>routes.set('GET '+route,handlers[handlers.length-1]),
  post:(route,...handlers)=>routes.set('POST '+route,handlers[handlers.length-1])
 };
 const client={
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.startsWith('SELECT school_id,gatekeeper_user_id'))return {rowCount:existing?1:0,rows:existing?[existing]:[]};
   if(sql.startsWith('SELECT s.student_id')||sql.startsWith('SELECT su.user_id'))return {rowCount:subject?1:0,rows:subject?[subject]:[]};
   if(sql.startsWith('UPDATE offline_gate_observations'))return {rowCount:1,rows:[{event_id:params[1]}]};
   return {rowCount:1,rows:[]};
  },
  release(){}
 };
 const pool={connect:async()=>client,query:client.query};
 registerGateOfflineRoutes(app,pool,{authenticateSchoolClient(){},requireSchoolRoles:()=>()=>{}});
 const call=async(method,route,body={},auth={role:'GATE_KEEPER',type:'SCHOOL_USER',schoolId:randomUUID(),userId:randomUUID()},params={})=>{
  const req={body,auth,params},out={statusCode:200,body:null,headers:{}};
  const res={
   set(k,v){out.headers[k]=v;return this;},
   status(value){out.statusCode=value;return this;},
   json(value){out.body=value;return this;}
  };
  await routes.get(method+' '+route)(req,res);
  return out;
 };
 return {call,queries};
}
test('prepare is Gatekeeper-only and uses 12-hour online authorization',async()=>{
 const h=harness(),r=await h.call('GET','/api/gate/offline/prepare');
 assert.equal(r.statusCode,200);
 assert.equal(r.body.role,'GATE_KEEPER');
 assert.ok(Date.parse(r.body.validUntil)>Date.now()+11*3600000);
 assert.equal(r.headers['Cache-Control'],'no-store, private');
 const src=read('gate-offline-routes.js');
 assert.match(src,/requireSchoolRoles\('GATE_KEEPER'\)/);
 assert.match(src,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
});
test('invalid/forged offline QR never reaches database writes',async()=>{
 const h=harness();
 const bad=await h.call('POST','/api/gate/offline/reconcile',{
  events:[{eventId:randomUUID(),qr:'fake',capturedAtDevice:new Date().toISOString()}]
 });
 assert.equal(bad.statusCode,400);
 assert.equal(h.queries.length,0);
});
test('valid offline QR is only stored in review queue, never official attendance',async()=>{
 const h=harness({subject:{id:'S-123',has_photo:true}});
 const eventId=randomUUID(),stamp=new Date().toISOString();
 const r=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId,qr:'JHS:'+randomUUID(),capturedAtDevice:stamp
 }]});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.officialAttendance,false);
 assert.equal(r.body.results[0].status,'REVIEW_REQUIRED');
 assert.ok(h.queries.some(q=>q.sql.includes('INSERT INTO offline_gate_observations')));
 assert.ok(h.queries.some(q=>q.sql.includes('GATE_OFFLINE_OBSERVATION_RECEIVED')));
 assert.ok(h.queries.every(q=>!q.sql.includes('INSERT INTO attendance_events')));
 assert.ok(h.queries.every(q=>!q.sql.includes('INSERT INTO staff_attendance_events')));
 assert.ok(h.queries.every(q=>!q.sql.includes('UPDATE students')));
});
test('unknown badge stays in invalid review state and never creates an attendance event',async()=>{
 const h=harness(),r=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId:randomUUID(),qr:'TCH:'+randomUUID(),capturedAtDevice:new Date().toISOString()
 }]});
 assert.equal(r.body.results[0].status,'INVALID_BADGE');
 assert.equal(r.body.results[0].officialAttendance,false);
});
test('replaying another school idempotency key fails closed',async()=>{
 const schoolId=randomUUID(),userId=randomUUID(),rival=randomUUID(),key=randomUUID(),code='JHS:'+randomUUID();
 const h=harness({existing:{school_id:rival,gatekeeper_user_id:userId,
  subject_kind:'STUDENT',badge_sha256:'a'.repeat(64),captured_at_device:new Date()}});
 const result=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId:key,qr:code,capturedAtDevice:new Date().toISOString()
 }]},{role:'GATE_KEEPER',type:'SCHOOL_USER',schoolId,userId});
 assert.equal(result.statusCode,409);
 assert.ok(h.queries.some(q=>q.sql==='ROLLBACK'));
});
test('device encryption, scope matching and cache controls preserve online permissions',()=>{
 const js=read('public/gate-offline.js'),html=read('public/gate-offline.html');
 const sw=read('public/sw.js'),sql=read('migrations/064_offline_gate_observation_review.sql');
 const server=read('server.js'),portal=read('public/portal.js');
 assert.match(js,/AES-GCM/);assert.match(js,/PBKDF2/);assert.match(js,/310000/);
 assert.match(js,/secretKey/);assert.match(js,/navigator\.storage\?\.persist/);
 assert.match(js,/identity\.schoolId!==data\.scope\.schoolId/);
 assert.match(js,/identity\.userId!==data\.scope\.userId/);
 assert.match(js,/officialAttendance!==false/);
 assert.match(js,/await save\(\)/);
 assert.match(js,/await api\('\/api\/gate\/offline\/prepare'\)/);
 assert.match(js,/Date\.now\(\)>Date\.parse\(data\.scope\.validUntil\)/);
 assert.match(html,/html5-qrcode\.min\.js/);
 assert.match(sw,/\"\/gate-offline\.html\"/);
 assertCachedAsset(html,sw,'gate-offline.js',{minimumVersion:1});
 assert.match(sw,/\"\/vendor\/html5-qrcode\.min\.js\"/);
 assert.doesNotMatch(sw.split('const SHELL = [')[1]?.split('];')[0]||'',/\"\/portal\.html\"/);
 assert.match(sql,/CHECK\(status IN \('REVIEW_REQUIRED','INVALID_BADGE','CLOSED_REVIEWED','DISMISSED'\)\)/);
 assert.match(server,/registerGateOfflineRoutes\(app,pool/);
 assert.match(portal,/gateOfflineCaptureLink/);
 assert.doesNotMatch(js,/localStorage\.setItem/);
});
