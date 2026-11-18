'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerStaffGateDtrRoutes}=require('../staff-gate-dtr-routes');

const html=fs.readFileSync('public/portal.html','utf8');
const portal=fs.readFileSync('public/portal.js','utf8');
const lunch=fs.readFileSync('public/staff-lunch-ui.js','utf8');
const form=fs.readFileSync('public/form48-report.js','utf8');

test('lunch presenter and Form 48 reporting are separate from teacher accounts',()=>{
  for(const id of ['lunchQrAdminView','teacherLunchQrView','form48ReportsView','staffLunchAdminCard','staffLunchPresenterCard'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(portal,/relocate\('lunchQrAdminNav', 'operations'\)/);
  assert.match(portal,/relocate\('form48ReportsNav', 'reports'\)/);
  assert.match(portal,/relocate\('myGateAttendanceNav', 'operations'\)/);
  assert.match(portal,/teacherLunchQr: \['My lunch QR'/);
  assert.match(lunch,/const view=\$\('teacherLunchQrView'\)/);
  assert.match(form,/AM_IN','AM_OUT','PM_IN','PM_OUT/);
});

function setup() {
 const handlers=new Map();
 const app={
   get(path,...mw){handlers.set(path,mw.at(-1));},
   post(){},
 };
 const calls=[];
 const id='22222222-2222-4222-8222-222222222222';
 const staff={displayName:'Teacher Example',role:'TEACHER'};
 const pool={async query(sql,args){
   calls.push({sql,args});
   if(sql.includes('SELECT display_name AS "displayName",role'))
     return {rowCount:args[1]===id?1:0,rows:args[1]===id?[staff]:[]};
   if(sql.includes('SELECT user_id AS "userId"'))return {rows:[{userId:id,...staff}]};
   if(sql.includes('staff_attendance_events'))return {rows:[
     {schoolDate:'2026-11-18',slot:'AM_IN',localTime:'07:25'},
     {schoolDate:'2026-11-18',slot:'AM_OUT',localTime:'12:00'},
   ]};
   return {rows:[]};
 }};
 registerStaffGateDtrRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:(...roles)=>roles});
 async function get(path,query,role='SCHOOL_ADMIN') {
   const req={query,auth:{type:'SCHOOL_USER',role,schoolId:'school-A',userId:'admin-A'}};
   const res={code:200,set(){return this},status(code){this.code=code;return this},json(value){this.body=value;return this}};
   await handlers.get(path)(req,res);
   return res;
 }
 return {get,calls,id};
}
test('Form 48 administrator monthly API is scoped and never invents incomplete DTR times',async()=>{
 const {get,calls,id}=setup();
 const route='/api/staff-attendance/admin/form48';
 assert.equal((await get(route,{month:'2026-11',staffUserId:id},'TEACHER')).code,403);
 assert.equal((await get(route,{month:'11/2026',staffUserId:id})).code,400);
 assert.equal((await get(route,{month:'2026-11',staffUserId:'33333333-3333-4333-8333-333333333333'})).code,404);
 const res=await get(route,{month:'2026-11',staffUserId:id});
 assert.equal(res.code,200);
 assert.equal(res.body.records.length,30);
 assert.equal(res.body.records[17].slots.AM_IN,'07:25');
 assert.equal(res.body.records[17].slots.AM_OUT,'12:00');
 assert.equal(res.body.records[17].slots.PM_IN,null);
 assert.equal(res.body.records[17].slots.PM_OUT,null);
 assert(calls.some(x=>x.sql.includes("verification_status='VERIFIED'")));
 assert(calls.some(x=>x.sql.includes('school_id=$1') && x.args[0]==='school-A'));
});

test('Form 48 Day header fits and report-specific cells override dashboard padding',()=>{
 const css=fs.readFileSync('public/form48-report.css','utf8');
 assert.match(css,/#form48PrintArea \.form48-sheet th,#form48PrintArea \.form48-sheet td\{border:/);
 assert.match(css,/#form48PrintArea \.form48-sheet thead tr:first-child th:first-child,#form48PrintArea \.form48-sheet tbody td:first-child\{width:42px;min-width:42px;white-space:nowrap\}/);
 assert.doesNotMatch(css,/\.form48-sheet th:first-child,\.form48-sheet td:first-child\{width:23px\}/);
 assert.match(css,/#form48PrintArea \.form48-sheet th,#form48PrintArea \.form48-sheet td\{height:4\.8mm;padding:1px 0;font-size:7\.5px\}/);
 assert.match(html,/href="\/form48-report\.css\?v=5"/);
});
