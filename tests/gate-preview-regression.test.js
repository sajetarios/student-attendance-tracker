'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {decideNextGateEvent} = require('../gate-event-decision');
const boundary = require('../gate-attendance-boundary');

const code = fs.readFileSync(require.resolve('../server.js'),'utf8');
const staffId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const badge='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function route(start,end) {
  const begin=code.indexOf(start), finish=code.indexOf(end,begin);
  assert.ok(begin>=0 && finish>begin,'Gate route markers must remain present');
  return code.slice(begin,finish);
}
function buildHandler(source,pool) {
  let handler;
  const app={post:(_path,...args)=>{handler=args.at(-1);}};
  vm.runInNewContext(source,{
    app,pool,authenticateSchoolClient:()=>{},requireSchoolRoles:()=>{},
    isUuid:value=>/^[a-f0-9]{8}-[a-f0-9-]{27,}$/.test(value),
    require:id=>id.includes('gate-event-decision')?{decideNextGateEvent}:
      id.includes('gate-attendance-boundary')?boundary:
      id==='node:crypto'?crypto:require(id),
    Date,Intl,console
  });
  assert.equal(typeof handler,'function');
  return handler;
}
async function invoke(handler,body,role='GATE_KEEPER'){
  let status=200,result;
  const res={set(){return res;},status(n){status=n;return res;},json(v){result=v;return res;}};
  await handler({body,auth:{schoolId:staffId,userId:staffId,role}},res);
  return {status,result};
}
const previewSource=route("app.post('/api/gate/teacher-event-preview'","// Automatic staff gate punch");
const automaticSource=route("app.post('/api/gate/teacher-auto-event'","// Roster:");

async function preview(opts={}){
  const o={history:[],when:'2026-11-23T07:30:00+08:00',localTime:'07:30',closed:false,photo:true,...opts};
  const calls=[];
  const pool={query:async sql=>{
    calls.push(sql);
    if(sql.includes('FROM school_users'))return {rowCount:o.photo?1:0,rows:o.photo?[{user_id:staffId}]:[]};
    if(sql.includes('clock_timestamp() AS'))return {rows:[{now:o.when,schoolDate:'2026-11-23',localTime:o.localTime}]};
    if(sql.includes('FROM school_calendar_exceptions'))return {rows:o.closed?[{exception_type:'CLOSED'}]:[]};
    if(sql.includes(') movements ORDER BY'))return {rows:o.history.map((eventType,i)=>({eventType,occurredAt:(o.timestamps||[])[i]||'2026-11-23T06:00:00+08:00'}))};
    throw new Error('Unmocked preview query');
  }};
  const output=await invoke(buildHandler(previewSource,pool),{teacherQrToken:badge});
  return {...output,calls};
}
test('read-only preview follows alternating gate movements with AM/PM labels',async()=>{
  const cases=[
    [[], '07:30','AM Time-In'],
    [['TIME_IN'],'11:45','AM Time-Out'],
    [['TIME_IN','TIME_OUT'],'13:00','PM Time-In'],
    [['TIME_IN','TIME_OUT','TIME_IN'],'17:00','PM Time-Out']
  ];
  for(const [history,localTime,label] of cases){
    const {status,result,calls}=await preview({history,localTime});
    assert.equal(status,200);
    assert.equal(result.label,label);
    assert.equal(result.recordingTarget,'PHYSICAL_GATE');
    assert.equal(calls.some(q=>/\b(INSERT|UPDATE|DELETE)\b/.test(q)),false);
  }
});
test('preview rejects closed days, invalid histories and missing staff photo',async()=>{
  assert.equal((await preview({closed:true})).result.status,'BLOCKED');
  assert.equal((await preview({history:['TIME_IN','TIME_IN']})).result.status,'REVIEW');
  assert.equal((await preview({photo:false})).status,404);
  assert.equal((await preview({history:['TIME_IN'],timestamps:['2026-11-23T07:29:20+08:00']})).result.status,'RECENT_SCAN');
});

async function automatic(opts={}){
 const o={history:[],timestamps:[],now:'2026-11-23T17:00:00+08:00',closed:false,photo:true,duplicate:null,expected:undefined,verified:true,...opts};
 const calls=[];
 const pool={connect:async()=>({
   release(){},
   query:async (sql,params)=>{
     calls.push({sql,params});
     if(['BEGIN','ROLLBACK','COMMIT'].includes(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:0};
     if(sql.includes('SELECT user_id,display_name FROM school_users'))return {rowCount:o.photo?1:0,rows:o.photo?[{user_id:staffId,display_name:'Fictional Teacher'}]:[]};
     if(sql.includes('FROM staff_attendance_events WHERE school_id=$1 AND client_event_key=$2'))return {rowCount:o.duplicate?1:0,rows:o.duplicate?[{eventId:key,staffUserId:staffId,gateDirection:o.duplicate,occurredAt:o.now}]:[]};
     if(sql.includes('SELECT clock_timestamp() AS occurred_at'))return {rows:[{occurred_at:o.now,school_date:'2026-11-23'}]};
     if(sql.includes('FROM school_calendar_exceptions'))return {rows:o.closed?[{exception_type:'CLOSED'}]:[]};
     if(sql.includes(') gate_history ORDER BY'))return {rows:o.history.map((eventType,i)=>({eventType,occurredAt:o.timestamps[i]||'2026-11-23T07:00:00+08:00'}))};
     if(sql.includes('INSERT INTO staff_attendance_events'))return {rows:[{eventId:key,gateDirection:params[3],occurredAt:o.now}]};
     if(sql.includes('INSERT INTO audit_logs'))return {rowCount:1};
     throw new Error('Unmocked automatic recording query');
   }
 })};
 const body={teacherQrToken:badge,photoVerified:o.verified,clientEventKey:key};
 if(o.expected!==undefined)body.expectedGateEventType=o.expected;
 const output=await invoke(buildHandler(automaticSource,pool),body);
 return {...output,calls};
}
test('automatic recording alternates gate movements with required audit writes',async()=>{
 for(const [history,type] of [
   [[], 'TIME_IN'],[['TIME_IN'],'TIME_OUT'],[['TIME_IN','TIME_OUT'],'TIME_IN'],
   [['TIME_IN','TIME_OUT','TIME_IN'],'TIME_OUT']
 ]){
   const {status,result,calls}=await automatic({history,expected:type});
   assert.equal(status,201);
   assert.equal(result.event.eventType,type);
   assert.equal(calls.filter(x=>x.sql.includes('INSERT INTO staff_attendance_events')).length,1);
   assert.equal(calls.filter(x=>x.sql.includes('INSERT INTO audit_logs')).length,1);
   assert.equal(calls.some(x=>/INSERT INTO (dtr|ob_|official_business)/i.test(x.sql)),false);
 }
});
test('changed preview blocks recording and rolls back without an audit row',async()=>{
 const {status,result,calls}=await automatic({history:['TIME_IN'],expected:'TIME_IN'});
 assert.equal(status,409);
 assert.equal(result.status,'PREVIEW_CHANGED');
 assert.equal(calls.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(calls.some(x=>x.sql.includes('INSERT INTO')),false);
});
test('duplicate QR scans, closed days and ambiguous sequences fail safely',async()=>{
 assert.equal((await automatic({duplicate:'IN'})).result.alreadyRecorded,true);
 assert.equal((await automatic({closed:true})).status,409);
 assert.equal((await automatic({history:['TIME_OUT']})).status,409);
 assert.equal((await automatic({history:['TIME_IN'],timestamps:['2026-11-23T16:59:20+08:00']})).result.status,'RECENT_SCAN');
 assert.equal((await automatic({photo:false})).status,404);
 assert.equal((await automatic({verified:false})).status,400);
});
test('server rejects client-side selection of a gate event',async()=>{
 const source=automaticSource;
 assert.match(source,/validateAutomaticGateRecording/);
 assert.match(source,/expectedGateEventType!==decision.eventType/);
 assert.match(source,/pg_advisory_xact_lock/);
});
