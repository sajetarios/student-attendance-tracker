'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('date overrides preserve regular slot, only affect matching period and exact date',()=>{
 const source=read('public/portal.js');
 const code=source.slice(source.indexOf('  function scheduleDateOverride('),source.indexOf('  async function loadScheduleAdjustments('));
 const adjustment={periodId:'p1',date:'2026-11-25',type:'RESCHEDULE',startTime:'15:15',endTime:'15:50'};
 const sandbox={scheduleAdjustments:[adjustment]};
 vm.runInNewContext(code,sandbox);
 const period={periodId:'p1',weekdays:[1,2,3,4,5],startTime:'15:15',endTime:'16:10'};
 const previous=sandbox.scheduleOnDay(period,'2026-11-25'),next=sandbox.scheduleOnDay(period,'2026-11-26');
 assert.equal(previous.endTime,'15:50');assert.equal(previous.regularEndTime,'16:10');
 assert.equal(next.endTime,'16:10');assert.equal(next.adjustment,null);
 assert.equal(sandbox.scheduleOnDay(period,'2026-12-02').endTime,'16:10');
 assert.equal(sandbox.scheduleOnDay({...period,periodId:'p2'},'2026-11-25').endTime,'16:10');
 assert.equal(period.endTime,'16:10');
});
test('weekly rendering shares regular rows while showing actual adjusted times and today',()=>{
 const window={addEventListener(){},matchMedia(){return {matches:false};}};
 vm.runInNewContext(read('public/timetable-grid.js'),{window,document:{},AbortController,clearTimeout,setTimeout});
 const host={innerHTML:'',classList:{add(){}},addEventListener(){}};
 const common={periodId:'p1',subjectName:'English',gradeLevel:'8',section:'Celerio',startTime:'15:15',endTime:'16:10'};
 const change={...common,dayIndex:3,date:'2026-11-25',endTime:'15:50',regularStartTime:'15:15',regularEndTime:'16:10',adjustment:{type:'RESCHEDULE'}};
 const normal={...common,dayIndex:4,date:'2026-11-26'};
 window.TimetableGrid.render({host,days:[3,4],weekdayDates:{3:'2026-11-25',4:'2026-11-26'},today:'2026-11-26',entries:[change,normal]});
 assert.equal((host.innerHTML.match(/<th scope="row"/g)||[]).length,1);
 assert.match(host.innerHTML,/Past change/);assert.match(host.innerHTML,/3:15 PM–3:50 PM/);
 assert.match(host.innerHTML,/aria-current="date"/);assert.match(host.innerHTML,/Today/);
 assert.match(host.innerHTML,/3:15 PM to 4:10 PM/);
 for(const [today,status] of [['2026-11-25','Active'],['2026-11-24','Upcoming']]){
  window.TimetableGrid.render({host,days:[3,4],weekdayDates:{3:'2026-11-25',4:'2026-11-26'},today,entries:[change,normal]});
  assert.ok(host.innerHTML.includes(status+' change'));
 }
});
