'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readWindows,withinWindow,scheduleDecision}=require('../staff-lunch-windows');
const windows={AM_OUT:{start:'11:00',end:'12:30'},PM_IN:{start:'12:30',end:'13:30'}};
const hours={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'};
const settings={workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},dayReviews:{}};
test('optional operational windows validate both slots, preserve legacy behavior and respect boundaries',()=>{
 assert.deepEqual(readWindows(windows),windows);
 assert.equal(readWindows(null),null);
 assert.equal(readWindows({AM_OUT:{start:'12:00',end:'11:00'},PM_IN:windows.PM_IN}),undefined);
 assert.equal(withinWindow(null,'AM_OUT','01:00'),true);
 assert.equal(withinWindow(windows,'AM_OUT','11:00'),true);
 assert.equal(withinWindow(windows,'AM_OUT','12:30'),true);
 assert.equal(withinWindow(windows,'AM_OUT','12:31'),false);
});
test('official DTR schedule stays authoritative with workdays, calendar, reviews and memoranda',()=>{
 const base={date:'2026-11-24',slot:'PM_IN',time:'13:00',settings};
 assert.equal(scheduleDecision(base),null);
 assert.equal(scheduleDecision({...base,time:'09:00'}),'OUTSIDE_OFFICIAL_DTR_SLOT');
 assert.equal(scheduleDecision({...base,date:'2026-11-29'}),'NOT_SCHEDULED_WORKDAY');
 assert.equal(scheduleDecision({...base,calendar:[{date:base.date,type:'CLOSED'}]}),'NOT_SCHEDULED_WORKDAY');
 assert.equal(scheduleDecision({...base,calendar:[{date:base.date,type:'SHORTENED_DAY'}]}),'CALENDAR_EXCEPTION_REVIEW');
 assert.equal(scheduleDecision({...base,settings:null}),'OFFICIAL_SCHEDULE_UNAVAILABLE');
 assert.equal(scheduleDecision({...base,settings:{...settings,dayReviews:{[base.date]:'EXCUSED'}}}),'DAY_ALREADY_REVIEWED');
 const memo={from:base.date,to:base.date,hours:{AM_IN:'07:00',AM_OUT:'10:00',PM_IN:'11:00',PM_OUT:'14:00'}};
 assert.equal(scheduleDecision({...base,time:'11:00',adjustments:[memo]}),null);
 assert.equal(scheduleDecision({...base,time:'11:00',adjustments:[{...memo,archivedDate:base.date}]}),'OUTSIDE_OFFICIAL_DTR_SLOT');
});
