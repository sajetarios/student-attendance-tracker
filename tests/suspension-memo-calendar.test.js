'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {summarizeForm48}=require('../form48-calculations');
const {schoolDays}=require('../sardo-routes');
const root=path=>fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8');

test('learner-only class suspension does not change an employee scheduled DTR workday',()=>{
 const settings={workdays:[1,2,3,4,5],regularHours:{AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'},saturdayHours:{},dayReviews:{}};
 const records=[{date:'2026-11-23',slots:{AM_IN:'07:45',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'}}];
 const result=summarizeForm48({month:'2026-11',today:'2026-11-24',records,settings,
  calendar:[{date:'2026-11-23',type:'CLASS_SUSPENSION'}]});
 const assessment=result.assessments.find(a=>a.date==='2026-11-23');
 assert.equal(assessment.scheduled,true);
 assert.equal(assessment.lateMinutes,15);
 assert.equal(assessment.calendarException,'CLASS_SUSPENSION');
 const closed=summarizeForm48({month:'2026-11',today:'2026-11-24',records,settings,
  calendar:[{date:'2026-11-23',type:'CLOSED'}]});
 assert.equal(closed.assessments.find(a=>a.date==='2026-11-23').scheduled,false);
});
test('SARDO excludes a full-day suspension while retaining a mid-day learner school day',()=>{
 const days=[{weekday:1,isOperatingDay:true},{weekday:2,isOperatingDay:true},{weekday:3,isOperatingDay:true}];
 const date='2026-11-23';
 const full=schoolDays('2026-11-25',days,[{date,type:'CLASS_SUSPENSION',suspensionTime:null}],3);
 const partial=schoolDays('2026-11-25',days,[{date,type:'CLASS_SUSPENSION',suspensionTime:'10:30'}],3);
 assert.ok(!full.includes(date));
 assert.ok(partial.includes(date));
});
test('same existing School Calendar form links signed learner suspension memorandum',()=>{
 const js=root('public/portal.js'),html=root('public/portal.html'),routes=root('scheduling-config-routes.js');
 const db=root('migrations/082_link_suspension_calendar_and_date_changes.sql');
 const registry=root('scripts/migrate.js');
 for(const id of ['calendarExceptionType','calendarSuspensionTime','calendarMemoId','adjustmentMemoId'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/loadLinkedPrincipalMemos/);
 assert.match(js,/suspensionTime:type==='CLASS_SUSPENSION'/);
 assert.match(js,/memoId:type==='CLASS_SUSPENSION'/);
 assert.match(routes,/kind==='CLASS_SUSPENSION'/);
 assert.match(routes,/memo\.rows\[0\]\.audience!=='ALL_USERS'/);
 assert.match(routes,/DO NOTHING/);
 assert.match(routes,/SAVE_CALENDAR_EXCEPTION/);
 assert.match(db,/FOREIGN KEY \(school_id,memo_id\)/);
 assert.match(registry,/082_link_suspension_calendar_and_date_changes\.sql/);
});
test('date-specific per-class schedule links same memorandum without duplicate cancellation',()=>{
 const src=root('flexible-schedule-routes.js');
 assert.match(src,/memoId=b\.memoId\|\|null/);
 assert.match(src,/m\.title AS "memoTitle"/);
 assert.match(src,/exception_type==='CLASS_SUSPENSION'/);
 assert.match(src,/memo_id=EXCLUDED\.memo_id/);
 assert.match(src,/effective_date<=\$3::date AND end_date>=\$3::date/);
});
test('all QR recording modes enforce current school calendar cutoff without clearing old events',()=>{
 const qr=root('class-qr-routes.js'),pin=root('class-qr-pin-checkin.js');
 assert.match(qr,/async function classCalendarSuspended/);
 assert.match(qr,/calendar_date\+suspension_time/);
 assert.match(qr,/if\(result\.suspended\)/);
 assert.match(qr,/await classCalendarSuspended\(client,s\.school_id,s\.school_date\)/);
 assert.match(pin,/if\(result\.suspended\)/);
 assert.doesNotMatch(qr,/DELETE FROM class_qr_checkins/);
});
test('manual marks, sign-off, SF2 and SARDO read the same school calendar authority',()=>{
 const manual=root('manual-attendance-routes.js');
 const signoff=root('class-finalization-routes.js');
 const sf2=root('sf2-routes.js'),sardo=root('sardo-routes.js'),memo=root('school-memo-routes.js');
 for(const src of [manual,signoff])assert.match(src,/CLASS_SUSPENSION/);
 assert.match(sf2,/noClassDates/);
 assert.match(sf2,/partialSuspensionDates/);
 assert.match(sf2,/A normal SF2 absence cannot be confirmed/);
 assert.match(sardo,/CLASS_SUSPENSION/);
 assert.match(memo,/category==='CLASS_SUSPENSION'&&audience!=='ALL_USERS'/);
});
