'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerManualAttendanceRoutes } = require('../manual-attendance-routes');

const periodId = '11111111-1111-4111-8111-111111111111';
const studentId = 'STU-001';
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

function setup({ prior, expectedRevision, status = 'PRESENT' }) {
  let handler;
  const seen = [];
  const app = {
    post(route, ...middleware) {
      if (route === '/api/manual-attendance/sync') handler = middleware.at(-1);
    },
    get() {}
  };
  const client = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM class_periods p/.test(sql))
        return { rows: [{period_id:periodId,grade_level:'8',section:'Rizal'}], rowCount:1 };
      if (/FROM class_attendance_finalizations/.test(sql)) return {rows:[],rowCount:0};
      if (/SELECT 1 FROM students s/.test(sql)) return {rows:[{}],rowCount:1};
      if (/SELECT status,note,revision FROM manual_attendance_marks/.test(sql))
        return {rows:prior?[prior]:[],rowCount:prior?1:0};
      if (/UPDATE manual_attendance_marks SET status/.test(sql))
        return {rows:[{revision:3}],rowCount:1};
      if (/INSERT INTO manual_attendance_marks/.test(sql))
        return {rows:[{revision:1}],rowCount:1};
      return {rows:[],rowCount:0};
    },
    release() {}
  };
  registerManualAttendanceRoutes(app,{connect:async()=>client,query:(...args)=>client.query(...args)},{
    authenticateSchoolClient:(_req,_res,next)=>next(),
    requireSchoolRoles:()=> (_req,_res,next)=>next()
  });
  const req = {
    auth:{schoolId:'22222222-2222-4222-8222-222222222222',userId:'33333333-3333-4333-8333-333333333333'},
    body:{periodId,date:'2026-11-16',marks:[{studentId,status,note:'',expectedRevision}]}
  };
  let responseStatus = 200, responseBody;
  const res = {
    status(number){responseStatus=number;return this;},
    json(value){responseBody=value;return this;}
  };
  return { seen, run:async()=>{await handler(req,res);return {status:responseStatus,body:responseBody}} };
}

test('stale manual attendance draft cannot overwrite another teacher correction',async()=>{
  const scenario=setup({prior:{status:'ABSENT',note:'',revision:'2'},expectedRevision:1});
  const response=await scenario.run();
  assert.equal(response.status,409);
  assert.equal(response.body.code,'STALE_MANUAL_MARK');
  assert.ok(scenario.seen.some(s=>s.sql==='ROLLBACK'));
  assert.ok(!scenario.seen.some(s=>/UPDATE manual_attendance_marks SET status/.test(s.sql)));
});

test('current manual revision updates atomically and increments on success',async()=>{
  const scenario=setup({prior:{status:'ABSENT',note:'',revision:'2'},expectedRevision:2});
  const response=await scenario.run();
  assert.equal(response.status,200);
  assert.equal(response.body.saved,1);
  const update=scenario.seen.find(s=>/UPDATE manual_attendance_marks SET status/.test(s.sql));
  assert.ok(update);
  assert.match(update.sql,/revision=revision\+1/);
  assert.match(update.sql,/AND revision=\$8/);
  assert.equal(update.params.at(-1),2);
  assert.ok(scenario.seen.some(s=>s.sql==='COMMIT'));
});

test('matching replay is idempotent, even when client revision is stale',async()=>{
  const scenario=setup({prior:{status:'PRESENT',note:'',revision:'7'},expectedRevision:0});
  const response=await scenario.run();
  assert.equal(response.status,200);
  assert.equal(response.body.saved,1);
  assert.ok(!scenario.seen.some(s=>/UPDATE manual_attendance_marks SET status/.test(s.sql)));
});

test('offline and online manuals include revisions and keep conflict audits',()=>{
  const migration=read('migrations/045_manual_attendance_optimistic_lock.sql');
  assert.match(migration,/ADD COLUMN IF NOT EXISTS revision BIGINT/);
  const server=read('manual-attendance-routes.js');
  assert.match(server,/revision=m.revision\+1/);
  assert.match(server,/pg_advisory_xact_lock/);
  const folio=read('public/manual-folio.js');
  assert.match(folio,/expectedRevision:Number\(state.synced\[studentId\]\?\.revision\|\|0\)/);
  const offline=read('public/offline-sheet.js');
  assert.match(offline,/data.revisions\[date\]\[m.studentId\]/);
});
