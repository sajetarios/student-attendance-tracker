'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planShortenedPeriods,validDurations}=require('../shortened-class-schedule');
const row=(id,startTime,endTime,extra={})=>({periodId:id,gradeLevel:'9',section:'Ponce',startTime,endTime,scheduleType:'CLASS',...extra});
test('55 to 45 minute periods compact consecutive slots while preserving a 15 minute break',()=>{
 const rows=[row('1','07:00','07:55'),row('2','07:55','08:50'),row('3','09:05','10:00')];
 assert.deepEqual(planShortenedPeriods(rows,55,45).map(p=>[p.startTime,p.endTime]),[['07:00','07:45'],['07:45','08:30'],['08:45','09:30']]);
 assert.equal(rows[0].endTime,'07:55');
});
test('same-day teaching change never moves started periods',()=>{
 const rows=[row('1','07:00','07:55',{recorded:true}),row('2','07:55','08:50')];
 assert.deepEqual(planShortenedPeriods(rows,55,45,'07:30').map(p=>[p.periodId,p.startTime,p.endTime]),[['2','07:55','08:40']]);
});
test('parallel sections share the same shortened time block, not double-counted',()=>{
 const rows=[row('1','07:00','07:55'),row('2','07:00','07:55',{section:'Rizal'}),row('3','07:55','08:50')];
 assert.equal(planShortenedPeriods(rows,55,45).find(p=>p.periodId==='3').startTime,'07:45');
});
test('reject accepted records, competing adjustments, staggered blocks and invalid durations',()=>{
 for(const flag of ['recorded','adjusted'])assert.throws(()=>planShortenedPeriods([row('1','07:00','07:55',{[flag]:true})],55,45),/attendance/);
 assert.throws(()=>planShortenedPeriods([row('1','07:00','07:55'),row('2','07:15','08:10',{section:'Rizal'})],55,45),/Overlapping/);
 assert.equal(validDurations(55,60),false);
});
