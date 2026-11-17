'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerClassFinalizationRoutes } = require('../class-finalization-routes');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const schoolId='11111111-1111-4111-8111-111111111111';
const teacherId='22222222-2222-4222-8222-222222222222';
const periodId='33333333-3333-4333-8333-333333333333';
const operationId='44444444-4444-4444-8444-444444444444';

function setup() {
  const audit=[], events=new Map();
  let handler;
  const pool={
    connect:async()=>({
      async query(sql,params=[]) {
        audit.push({sql,params});
        if (/FROM class_attendance_finalization_events WHERE event_id/.test(sql)) {
          const event=events.get(params[0]);
          return {rowCount:event?1:0,rows:event?[event]:[]};
        }
        if (/SELECT p.grade_level,p.section FROM class_periods/.test(sql))
          return {rowCount:1,rows:[{grade_level:'8',section:'Rizal'}]};
        if (/SELECT finalized,roster_count FROM class_attendance_finalizations/.test(sql))
          return {rowCount:0,rows:[]};
        if (/FROM school_calendar_exceptions/.test(sql))return {rowCount:0,rows:[]};
        if (/COUNT\(\*\)::int AS total/.test(sql))return {rowCount:1,rows:[{total:1,completed:1}]};
        if (/SELECT 1 FROM manual_attendance_marks m/.test(sql))return {rowCount:0,rows:[]};
        if (/INSERT INTO class_attendance_finalization_events/.test(sql)){
          events.set(params[5],{school_id:schoolId,period_id:periodId,school_date:'2026-11-16',
            action:'FINALIZE',actor_user_id:teacherId,roster_count:1});
          return {rowCount:1,rows:[]};
        }
        return {rowCount:0,rows:[]};
      },
      release() {}
    })
  };
  const app={post(route,...rest){if(route==='/api/manual-attendance/finalization')handler=rest.at(-1);}};
  registerClassFinalizationRoutes(app,pool,{
    authenticateSchoolClient:(_req,_res,next)=>next(),
    requireSchoolRoles:()=> (_req,_res,next)=>next()
  });
  async function submit(action='FINALIZE',id=operationId) {
    const req={auth:{schoolId,userId:teacherId},body:{periodId,date:'2026-11-16',action,operationId:id}};
    let status=200,body=null;
    const res={status(value){status=value;return this;},json(value){body=value;return this;}};
    await handler(req,res);
    return {status,body};
  }
  return {submit,audit,events};
}
test('register sign-off is acknowledged exactly once even if a device retries',async()=>{
  const {submit,audit,events}=setup();
  const first=await submit();
  assert.equal(first.status,200);
  assert.equal(first.body.finalized,true);
  assert.equal(events.size,1);
  const replay=await submit();
  assert.equal(replay.status,200);
  assert.equal(replay.body.alreadySynced,true);
  assert.equal(events.size,1);
  assert.equal(audit.filter(item=>/INSERT INTO class_attendance_finalization_events/.test(item.sql)).length,1);
});
test('replaying one operation ID with a different sign-off action is rejected',async()=>{
  const {submit}=setup();
  assert.equal((await submit()).status,200);
  const replay=await submit('REOPEN');
  assert.equal(replay.status,409);
  assert.equal(replay.body.code,'OPERATION_ID_CONFLICT');
});
test('QR scans, marks and sign-offs use a single durable account queue and server verification',()=>{
  const queue=read('public/offline-attendance.js');
  const server=read('server.js');
  const folio=read('public/manual-folio.js');
  const sheet=read('public/offline-sheet.js');
  assert.match(queue,/indexedDB\.open\(DB, 2\)/);
  assert.match(queue,/crypto\.subtle\.encrypt/);
  assert.match(queue,/non-extractable device key/);
  for(const kind of ['QR_SCAN','MANUAL_MARKS','REGISTER_SIGNOFF'])assert.ok(queue.includes(kind));
  assert.match(queue,/response\.status === 401 \|\| response\.status === 403/);
  assert.match(queue,/status: 'REVIEW'/);
  assert.match(queue,/verified\.json\(\)/);
  assert.match(server,/code:'FINALIZED_REGISTER'/);
  assert.match(server,/pg_advisory_xact_lock/);
  assert.match(folio,/enqueueOperation/);
  assert.match(sheet,/enqueueOperation/);
});
