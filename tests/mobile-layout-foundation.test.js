'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');

test('shared mobile action rows use intrinsic sizing instead of a fixed vertical basis',()=>{
 const repair=read('mobile-overflow-repair.css');
 const guard=read('attendigo-form-overlap-guard.css');
 const controls=read('role-controls-responsive.css');
 assert.match(repair,/flex:\s*0 1 auto;min-height:44px;height:auto/);
 assert.doesNotMatch(repair,/flex:\s*1 1 145px/);
 assert.match(guard,/flex:\s*0 1 auto;min-block-size:44px;block-size:auto/);
 assert.doesNotMatch(guard,/flex:\s*1 1 150px/);
 assert.match(controls,/flex:\s*0 1 auto;\s*width:100%/);
});

test('staff account toolbar stacks without stretching its text or action',()=>{
 const css=read('user-management-readability.css');
 assert.match(css,/#teachersView \.staff-accounts-card \.section-toolbar\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.staff-accounts-card \.section-toolbar>div\{flex:none;min-height:0;height:auto\}/);
 assert.match(css,/\.staff-accounts-card \.section-toolbar>button\{width:100%;flex:none;height:auto;min-height:44px/);
 assert.match(css,/td\.empty-cell::before\{display:none!important;content:none!important\}/);
});

test('Form 48 mobile helper text does not inherit a horizontal basis',()=>{
 assert.match(read('form48-report.css'),/#form48SchoolSignatories \.form48-schedule-actions span\{flex:0 1 auto\}/);
});

test('shared signed-in pages load the responsive guard and updated CSS can refresh online',()=>{
 for(const name of ['portal.html','student-portal.html','parent-portal.html']){
  assert.match(read(name),/href="\/attendigo-form-overlap-guard\.css\?v=2"/);
  assert.match(read(name),/href="\/role-controls-responsive\.css\?v=2"/);
 }
 const sw=read('sw.js');
 assert.match(sw,/attendigo-v372-mobile-layout-foundation/);
 for(const name of ['mobile-overflow-repair.css','user-management-readability.css','form48-report.css']){
  assert.ok(sw.includes("'/" + name + "'"),name+' should refresh online');
 }
});
