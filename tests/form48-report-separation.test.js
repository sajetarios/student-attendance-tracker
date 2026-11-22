'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertCachedAsset}=require('./support/asset-contract');
const fs=require('node:fs');
const {registerStaffGateDtrRoutes}=require('../staff-gate-dtr-routes');

const html=fs.readFileSync('public/portal.html','utf8');
const portal=fs.readFileSync('public/portal.js','utf8');
const lunch=fs.readFileSync('public/staff-lunch-ui.js','utf8');
const form=fs.readFileSync('public/form48-report.js','utf8');

test('lunch presenter and Form 48 reporting are separate from teacher accounts',()=>{
  for(const id of ['lunchQrAdminView','teacherLunchQrView','form48ReportsView','staffLunchAdminCard','staffLunchPresenterCard'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(portal,/relocate\('lunchQrAdminNav', 'attendanceManagement'\)/);
  assert.match(portal,/relocate\('form48ReportsNav', 'reports'\)/);
  assert.match(portal,/relocate\('myGateAttendanceNav', 'attendanceManagement'\)/);
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
   if(sql.includes('actual_gate ORDER BY'))return {rows:[{schoolDate:'2026-11-20',eventType:'TIME_IN',occurredAt:'2026-11-19T23:52:49.962Z'}]};
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
 assert.equal(res.body.records[19].slots.AM_IN,null,'gate evidence must not create an official DTR punch');
 assert.equal(res.body.records[19].verifiedCount,0,'gate evidence cannot affect DTR totals');
 assert.deepEqual(res.body.records[19].gateEvidence,[{direction:'IN',time:'07:52'}]);
 assert(calls.some(x=>x.sql.includes("verification_status='VERIFIED'")));
 assert(calls.some(x=>x.sql.includes('school_id=$1') && x.args[0]==='school-A'));
});

test('Form 48 Day header fits and report-specific cells override dashboard padding',()=>{
 const css=fs.readFileSync('public/form48-report.css','utf8');
 assert.match(css,/#form48PrintArea \.form48-sheet th,#form48PrintArea \.form48-sheet td\{border:/);
 assert.match(css,/#form48PrintArea \.form48-sheet thead tr:first-child th:first-child,#form48PrintArea \.form48-sheet tbody td:first-child\{width:42px;min-width:42px;white-space:nowrap\}/);
 assert.doesNotMatch(css,/\.form48-sheet th:first-child,\.form48-sheet td:first-child\{width:23px\}/);
 assert.match(css,/#form48PrintArea \.form48-sheet th,#form48PrintArea \.form48-sheet td\{height:4\.8mm;padding:1px 0;font-size:7\.5px\}/);
 const sw=fs.readFileSync('public/sw.js','utf8');
 assertCachedAsset(html,sw,'form48-report.css',{minimumVersion:9});
});

test('Form 48 print opens isolated A4 portrait report without dashboard or private controls',()=>{
 const js=fs.readFileSync('public/form48-report.js','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 assert.ok(js.includes('function printDtrFromIsolatedPage(output,status)'));
 assert.ok(js.includes("output.querySelector('.form48-sheets')"));
 assert.ok(js.includes("window.open('', '_blank')"));
 assert.ok(js.includes('<main id="form48PrintArea"'));
 assert.ok(js.includes('@page{size:A4 portrait;margin:5mm}'));
 assert.ok(js.includes('popup.document.write(html)'));
 assert.ok(!js.includes("if(!button.disabled&&!output.hidden)window.print()"));
 assert.ok(js.includes('width:194mm'));
 assert.ok(js.includes('Two copies on one page'));
 assert.doesNotMatch(js,/A4 landscape|287mm/);
 assertCachedAsset(html,sw,'form48-report.js',{minimumVersion:12});
});
test('Form 48 physical print is A4 portrait with two copies and no app logo',()=>{
 const css=fs.readFileSync('public/form48-report.css','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 assert.doesNotMatch(css,/A4 landscape|287mm/);
 assert.match(css,/@page\{size:A4 portrait;margin:5mm\}/);
 assert.match(css,/grid-template-columns:99mm 99mm!important/);
 assert.match(css,/min-height:264mm!important/);
 assert.match(css,/body:has\(#form48PrintArea:not\(\[hidden\]\)\)/);
 assertCachedAsset(html,sw,'form48-report.css',{minimumVersion:11});
});

test('iPad isolated print keeps 31 rows, certification and draft status in a single A4 page',()=>{
 const css=fs.readFileSync('public/form48-report.css','utf8');
 const js=fs.readFileSync('public/form48-report.js','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 assert.match(js,/class="form48-print-document"/);
 assert.match(css,/html\.form48-print-document #form48PrintArea \{/);
 assert.match(css,/position:static!important;inset:auto!important/);
 assert.match(css,/grid-template-columns:96mm 96mm!important/);
 assert.match(css,/min-height:264mm!important/);
 assert.match(css,/height:4\.1mm!important;min-height:4\.1mm!important/);
 assert.match(css,/html\.form48-print-document #form48PrintArea \.form48-draft-mark/);
 assert.match(js,/@page\{size:A4 portrait;margin:5mm\}/);
 assertCachedAsset(html,sw,'form48-report.css',{minimumVersion:12});
 assertCachedAsset(html,sw,'form48-report.js',{minimumVersion:12});
});

test('Form 48 isolated print has no inherited stylesheet, forced page breaks or app imagery',()=>{
 const script=fs.readFileSync('public/form48-report.js','utf8');
 const isolated=script.slice(script.indexOf('const standalonePrintCss = ['),script.indexOf('function init(user){'));
 assert.match(isolated,/standalonePrintCss/);
 assert.match(isolated,/'<style>'\+standalonePrintCss\+'<\/style>/);
 assert.doesNotMatch(isolated,/<link rel=|form48-report\.css\?v=/);
 assert.doesNotMatch(isolated,/page-break-after|break-after:page|break-inside:avoid|position:absolute!important/);
 assert.doesNotMatch(isolated,/assets\/|attendigo-logo|attendigo-official-emblem/);
 assert.match(isolated,/min-height:260mm/);
 assert.match(isolated,/height:4\.1mm/);
 assert.match(isolated,/grid-template-columns:96mm 96mm/);
});
