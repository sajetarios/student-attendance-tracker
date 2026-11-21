'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('legacy teacher gate ignores manipulated phone time and records the database timestamp',async()=>{
 const server=fs.readFileSync('server.js','utf8');
 const start=server.indexOf("app.post('/api/gate/teacher-events'");
 const end=server.indexOf('// Read-only preview of the next physical gate movement.',start);
 assert.ok(start>=0&&end>start);
 let handler;
 const queries=[],trusted='2026-11-22T00:30:00.000Z';
 const pool={async query(sql,params){
  queries.push({sql,params});
  if(sql.includes('SELECT instant AS'))return {rows:[{occurredAt:trusted,schoolDate:'2026-11-22'}]};
  if(sql.includes('FROM school_calendar_exceptions'))return {rows:[]};
  if(sql.includes('SELECT display_name FROM school_users'))return {rowCount:1,rows:[{display_name:'Fictional Teacher'}]};
  if(sql.includes('INSERT INTO teacher_gate_events'))return {rowCount:1,rows:[{eventId:'evt',eventType:'TIME_IN',occurredAt:params[3]}]};
  if(sql.includes('INSERT INTO audit_logs'))return {rowCount:1,rows:[]};
  throw Error('Unexpected query: '+sql.slice(0,80));
 }};
 vm.runInNewContext(server.slice(start,end),{
  app:{post(_path,...handlers){handler=handlers.at(-1);}},
  pool,authenticateSchoolClient:()=>{},requireSchoolRoles:()=>{},
  isUuid:value=>typeof value==='string'&&value.length===36,Date,Intl,console
 });
 let code=200,body;
 const res={status(n){code=n;return this;},json(x){body=x;return this;}};
 await handler({auth:{schoolId:'school-A',userId:'guard-A'},body:{
  teacherUserId:'11111111-1111-4111-8111-111111111111',
  eventType:'TIME_IN',occurredAt:'2000-01-01T00:00:00Z',schoolDate:'2000-01-01',photoVerified:true
 }},res);
 assert.equal(code,201);
 assert.equal(body.timestampSource,'SERVER');
 const record=queries.find(q=>q.sql.includes('INSERT INTO teacher_gate_events'));
 assert.equal(record.params[3],trusted);
 assert.equal(record.params[4],'2026-11-22');
 assert.equal(queries.some(q=>JSON.stringify(q.params||[]).includes('2000-01-01')),false);
});
test('Form 48 preview never implicitly saves monthly settings',()=>{
 const js=fs.readFileSync('public/form48-report.js','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const start=js.indexOf('async function generate()'),end=js.indexOf('if(saveSchedule){',start);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(js.slice(start,end),/method:'PUT'/);
 assert.match(js,/async function persistDraft\(\)/);
 assert.match(html,/id="form48SaveDraft"/);
 assert.match(html,/id="smartHoursPreset"/);
 assert.match(html,/id="form48DailyInsights"/);
});