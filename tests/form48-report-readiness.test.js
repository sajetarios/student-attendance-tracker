'use strict';
const {assertCacheRevisionAtLeast}=require('./support/asset-contract');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerForm48ReviewRoutes}=require('../form48-review-routes');
const html=fs.readFileSync('public/portal.html','utf8'),script=fs.readFileSync('public/form48-report.js','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
const staffId='22222222-2222-4222-8222-222222222222';
const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'};
function setup(){
 const routes=new Map(),queries=[];
 const app={get(path,...handlers){routes.set(path,handlers.at(-1));},put(){},post(){}};
 const pool={async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes('SELECT display_name FROM school_users'))return {rowCount:1,rows:[{display_name:'Teacher Example'}]};
  if(sql.includes('FROM school_operating_days'))return {rows:[1,2,3,4,5].map(weekday=>({weekday}))};
  if(sql.includes('FROM staff_form48_school_defaults'))return {rows:[{workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},revision:1}]};
  if(sql.includes('FROM staff_form48_monthly_reviews'))return {rows:[]};
  if(sql.includes('FROM staff_form48_employee_schedules'))return {rows:[]};
  if(sql.includes('FROM staff_leave_requests'))return {rows:[{from:'2026-11-20',to:'2026-11-20'}]};
  if(sql.includes('FROM school_users'))return {rows:[{teacher_status:'ACTIVE'}]};
  return {rows:[],rowCount:0};
 }};
 registerForm48ReviewRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
 async function get(path,month='2026-11',role='SCHOOL_ADMIN'){
  const req={query:{month,staffUserId:staffId},auth:{schoolId:'school-A',userId:'admin-A',role}};
  const response={code:200,set(){return this},status(code){this.code=code;return this},json(data){this.body=data;return this}};
  await routes.get(path)(req,response);return response;
 }
 return {queries,get};
}
test('Form 48 settings return for a selected employee even when the monthly review is new',async()=>{
 const {get,queries}=setup(),result=await get('/api/staff-attendance/admin/form48/config');
 assert.equal(result.code,200);
 assert.equal(result.body.review.configured,true);
 assert.deepEqual(result.body.review.regularHours,hours);
 assert.equal(queries.some(q=>q.sql.includes('FROM staff_leave_requests')),false);
});
test('Form 48 analysis includes pending sick leave without inventing verified punches',async()=>{
 const {get,queries}=setup(),result=await get('/api/staff-attendance/admin/form48/analysis');
 assert.equal(result.code,200);
 assert.equal(result.body.pendingSickLeaveCount,1);
 assert.equal(result.body.assessments.find(day=>day.date==='2026-11-20').status,'SICK_LEAVE_PENDING');
 assert.equal(result.body.summary.daysPresent,0);
 const pending=queries.find(q=>q.sql.includes('FROM staff_leave_requests'));
 assert.deepEqual(pending.params,['school-A',staffId,'2026-11-01','2026-12-01']);
});
test('Generate preview waits for settings and can retry after a failed load',()=>{
 assert.match(script,/const loaded=await \(configLoad&&state\.key===key\?configLoad:fetchConfig\(\)\)/);
 assert.match(script,/if\(!loaded\|\|!state\.review\)/);
 assert.match(script,/if\(person\.value&&month\.value\)fetchConfig\(\)/);
 assert.match(html,/form48-report\.js\?v=20/);
 assert.match(sw,/form48-report\.js\?v=20/);
 assertCacheRevisionAtLeast(sw,316);
});
