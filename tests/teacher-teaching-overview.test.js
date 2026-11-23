'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=n=>fs.readFileSync('public/'+n,'utf8');
const html=read('portal.html');
const client=read('teacher-teaching-overview.js');
const css=read('teacher-teaching-overview.css');
const worker=read('sw.js');
const route=fs.readFileSync('flexible-schedule-routes.js','utf8');
const {registerFlexibleScheduleRoutes}=require('../flexible-schedule-routes');
const school='22222222-2222-4222-8222-222222222222';
const teacher='33333333-3333-4333-8333-333333333333';
const period='44444444-4444-4444-8444-444444444444';

function setup({calendar=[],sf2=[{gradeLevel:'9',section:'Rizal',status:'SUBMITTED'}],
  conflicts=1,teacherId=teacher,periods=null,finalized=[]}={}){
 let handler;
 const seen=[];
 const app={get(path,...args){if(path==='/api/teacher/today-overview')handler=args.at(-1);},
   post(){},delete(){}};
 const mockPool={
  async query(sql,params){
   seen.push({sql,params});
   if(/FROM class_periods p/.test(sql))return {rows:periods||[{
     period_id:period,grade_level:'9',section:'Rizal',classroom:'Room A',
     teacher_user_id:teacher,subject_id:null,subject_name:'Mathematics',
     start_time:'09:00:00',end_time:'10:00:00',adjustment_type:null,
     alt_start:null,alt_end:null,alt_teacher:null
   }]};
   if(/FROM school_calendar_exceptions e/.test(sql))return {rows:calendar};
   if(/FROM manual_attendance_marks m/.test(sql))return {rows:[{total:conflicts}]};
   if(/FROM class_adviser_assignments ca/.test(sql))return {rows:sf2};
   if(/FROM class_attendance_finalizations/.test(sql))return {
     rows:finalized.map(id=>({period_id:id}))
   };
   throw Error('Unexpected SQL: '+sql.slice(0,140));
  }
 };
 registerFlexibleScheduleRoutes(app,mockPool,{
  authenticateSchoolClient:(_req,_res,next)=>next(),
  requireSchoolRoles:(...roles)=>(_req,_res,next)=>next()
 });
 assert.equal(typeof handler,'function');
 let status=200,body;
 const response={status(code){status=code;return this;},json(payload){body=payload;return this;}};
 const req={auth:{role:'TEACHER',schoolId:school,userId:teacherId}};
 return {seen,run:async()=>{await handler(req,response);return {status,body};}};
}

test('teacher overview respects role middleware and returns only read-only school-scoped evidence',async()=>{
 const fixture=setup({sf2:[{status:'SUBMITTED'},{status:'COLLECTED'},{status:null}]});
 const {status,body}=await fixture.run();
 assert.equal(status,200);
 assert.equal(body.attendance.verifiedConflictsToday,1);
 assert.equal(body.sf2.sections,3);
 assert.equal(body.sf2.submitted,1);
 assert.equal(body.sf2.collected,1);
 assert.equal(body.sf2.notSubmitted,1);
 assert.match(body.sf2.month,/^\d{4}-\d{2}$/);
 for(const item of fixture.seen){
  assert.equal(item.params[0],school);
  assert.doesNotMatch(item.sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
 }
 assert.match(route,/requireSchoolRoles\('TEACHER'\)/);
 assert.match(route,/e\.attendance_scope='CLASS'/);
 assert.match(route,/e\.sync_status='ACCEPTED'/);
 assert.match(route,/m\.status IN \('ABSENT','EXCUSED'\)/);
 assert.match(route,/sub\.is_current=TRUE/);
});

test('closed or learner-suspended day suppresses class suggestion and pending signoff',async()=>{
 for(const type of ['CLOSED','CLASS_SUSPENSION']){
  const {status,body}=await setup({calendar:[{type,title:'School closure',periodIds:[],suspensionTime:null}]}).run();
  assert.equal(status,200);
  assert.equal(body.nextClass,null);
  assert.equal(body.attendance.completedUnsignedToday,0);
  assert.match(body.scheduleMessage,/closure|closed|suspension/i);
 }
});

test('temporary substitution belongs to the appointed teacher, not the original teacher',async()=>{
 const altered=[{
   period_id:period,grade_level:'9',section:'Rizal',
   teacher_user_id:'77777777-7777-4777-8777-777777777777',
   subject_name:'Mathematics',start_time:'09:00:00',end_time:'10:00:00',
   adjustment_type:'SUBSTITUTE',alt_teacher:null
 }];
 const {body}=await setup({periods:altered,conflicts:0}).run();
 assert.equal(body.nextClass,null);
 assert.equal(body.attendance.completedUnsignedToday,0);
});

test('Teacher overview is read only, date-aware and reuses existing authorized buttons',()=>{
 assert.doesNotThrow(()=>new vm.Script(client));
 assert.match(client,/user\?\.role!=='TEACHER'/);
 assert.match(client,/\/api\/teacher\/today-overview/);
 assert.match(client,/cache:'no-store'/);
 assert.match(client,/snapshot\(\)/);
 assert.match(client,/byType\?\.MANUAL_MARKS/);
 assert.match(client,/byType\?\.REGISTER_SIGNOFF/);
 assert.match(client,/go\('schedules'\)/);
 assert.match(client,/go\('classAttendance'\)/);
 assert.match(client,/go\('sf2'\)/);
 assert.match(client,/counts\.sections/);
 assert.match(client,/sf2\.hidden/);
 assert.match(client,/timeZone:'Asia\/Manila'/);
 assert.doesNotMatch(client,/\b(?:POST|PATCH|DELETE|PUT)\b|fetch\([^,]*,\s*\{\s*method:/);
 assert.match(css,/@container \(min-width: 550px\)/);
 assert.match(css,/@container \(max-width: 320px\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/data-ui-theme="dark"/);
});

test('Overview resources are versioned and cached, existing shortcuts remain unique',()=>{
 for(const p of ['/teacher-teaching-overview.js?v=1','/teacher-teaching-overview.css?v=1']){
  assert.ok(html.includes(p),'portal includes '+p);
  assert.ok(worker.includes(p),'worker includes '+p);
 }
 const cacheVersion=Number(worker.match(/attendigo-v(\d+)-/)?.[1]);
 assert.ok(cacheVersion>=335,'Teacher overview requires PWA revision 335 or newer');
 assert.equal((html.match(/id="quickActionsCard"/g)||[]).length,1);
 const block=html.slice(html.indexOf('id="quickActionsCard"'),html.indexOf('</section>',html.indexOf('id="quickActionsCard"')));
 for(const route of ['students','schedules','sf2'])assert.ok(block.includes('data-go="'+route+'"'));
});
