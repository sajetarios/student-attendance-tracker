'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerForm48BulkRoutes,mergeSchoolForm48Defaults}=require('../form48-bulk-routes');
function setup(conflict=false){
 const handlers={},queries=[],roles=[];
 const app={get(){},post(){},put(path,...rest){handlers[path]=rest.at(-1);}};
 const client={async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes('INSERT INTO staff_form48_school_defaults'))
   return conflict?{rowCount:0,rows:[]}:{rowCount:1,rows:[{revision:2}]};
  return {rowCount:1,rows:[]};
 },release(){}};
 registerForm48BulkRoutes(app,{connect:async()=>client},{
  authenticateSchoolClient:()=>{},
  requireSchoolRoles:(...r)=>{roles.push(r);return ()=>{};}
 });
 const invoke=async body=>{
  const res={code:200,set(){return this},status(n){this.code=n;return this},
   json(v){this.body=v;return this}};
  await handlers['/api/staff-attendance/admin/form48/signatories']({
   body,auth:{schoolId:'school-A',userId:'admin-A'}},res);
  return res;
 };
 return {invoke,queries,roles};
}
const value={revision:1,verifiedBy:'In Charge',verifiedPosition:'Administrative Officer',
 approvedBy:'School Principal',approvedPosition:'Principal IV'};
test('school signatories are audited and scoped without editing DTR punches or hours',async()=>{
 const {invoke,queries,roles}=setup();
 const res=await invoke(value);
 assert.equal(res.code,200);
 assert.equal(res.body.revision,2);
 assert.ok(roles.some(r=>r.includes('SCHOOL_ADMIN')));
 const sql=queries.map(q=>q.sql).join('\n');
 assert.match(sql,/FORM48_SCHOOL_SIGNATORIES_UPDATED/);
 assert.match(sql,/COMMIT/);
 assert.doesNotMatch(sql,/staff_attendance_events|staff_form48_monthly_reviews|regular_hours=/);
 const upsert=queries.find(q=>q.sql.includes('INSERT INTO staff_form48_school_defaults'));
 assert.equal(upsert.params[0],'school-A');
 assert.equal(upsert.params[5],'admin-A');
 assert.equal(upsert.params[6],1);
});
test('stale signer revisions are rejected without audit',async()=>{
 const {invoke,queries}=setup(true);
 const res=await invoke(value);
 assert.equal(res.code,409);
 assert.ok(queries.some(q=>q.sql==='ROLLBACK'));
 assert.ok(!queries.some(q=>q.sql.includes('staff_attendance_audit')));
});
test('incomplete signatory information never reaches the database',async()=>{
 const {invoke,queries}=setup();
 assert.equal((await invoke({...value,approvedPosition:''})).code,400);
 assert.equal(queries.length,0);
});
test('all staff inherit signatories but keep separate approved schedules',()=>{
 const defaults={...value,workdays:[1,2,3,4,5],
  regularHours:{AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'},saturdayHours:{}};
 const teacher=mergeSchoolForm48Defaults({configured:true,workdays:[1,2,3,4,5],
  regularHours:{AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'},
  verifiedBy:'Old verifier',approvedBy:'Old approver'},defaults);
 const guard=mergeSchoolForm48Defaults({configured:true,workdays:[6],
  saturdayHours:{AM_IN:'06:00',AM_OUT:'11:00',PM_IN:'12:00',PM_OUT:'15:00'},
  verifiedBy:'Former verifier',approvedBy:'Former approver'},defaults);
 for(const r of [teacher,guard]){
  assert.equal(r.verifiedBy,'In Charge');
  assert.equal(r.verifiedPosition,'Administrative Officer');
  assert.equal(r.approvedBy,'School Principal');
  assert.equal(r.approvedPosition,'Principal IV');
 }
 assert.equal(teacher.regularHours.AM_IN,'08:00');
 assert.deepEqual(guard.workdays,[6]);
});
test('school signer form does not depend on employee selection; A4 printing is unchanged',()=>{
 const html=fs.readFileSync('public/portal.html','utf8');
 const report=fs.readFileSync('public/form48-report.js','utf8');
 const ui=fs.readFileSync('public/form48-bulk-ui.js','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 const pos=html.indexOf('id="form48SchoolSignatories"');
 assert.ok(pos>0&&pos<html.indexOf('id="form48FilterForm"'));
 for(const id of ['form48VerifiedBy','form48ApprovedBy','form48VerifiedPosition','form48ApprovedPosition']){
  assert.equal(html.split('id="'+id+'"').length,2);
  assert.ok(!report.includes("$('"+id+"')"));
 }
 assert.ok(ui.includes('/form48/signatories'));
 assert.ok(report.includes('attendigo:form48-signatories-saved'));
 assert.ok(report.includes('function printDtrFromIsolatedPage(output,status)'));
 assert.ok(report.includes('Two copies on one page'));
 for(const asset of ['/form48-report.js?v=15','/form48-bulk-ui.js?v=3','/form48-report.css?v=14']){
  assert.ok(html.includes(asset));assert.ok(sw.includes(asset));
 }
});
