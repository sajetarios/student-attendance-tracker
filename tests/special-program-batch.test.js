'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const routes=read('special-program-batch-routes.js');
const original=read('special-program-routes.js');
const portal=read('public/portal.html');
const main=read('public/portal.js');
const batchUi=read('public/special-program-batch-ui.js');
const migration=read('migrations/048_special_program_request_batches.sql');
const register=read('scripts/migrate.js');
const worker=read('public/sw.js');

test('batch migration only adds grouped references and preserves individual workflow',()=>{
 assert.match(register,/'048_special_program_request_batches\.sql'/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS special_program_request_batches/);
 assert.match(migration,/ALTER TABLE special_program_change_requests ADD COLUMN IF NOT EXISTS batch_id UUID/);
 assert.match(migration,/FOREIGN KEY \(school_id,batch_id\) REFERENCES special_program_request_batches\(school_id,batch_id\)/);
 assert.match(migration,/submitted_count<=selected_count/);
 assert.doesNotMatch(migration,/DROP TABLE|TRUNCATE TABLE|DELETE FROM students/i);
 assert.match(original,/registerSpecialProgramBatchRoutes\(app,pool,auth,/);
 assert.match(original,/r\.batch_id AS \\"batchId\\"/);
});
test('server routes protect requester and admin actions with server-side class scope',()=>{
 for(const endpoint of [
   "/api/special-programs/requests/bulk/preview",
   "/api/special-programs/requests/bulk",
   "/api/special-programs/batches/:id/review"])assert.ok(routes.includes(endpoint),endpoint);
 assert.match(routes,/const requester=u=>u\.role==='DEPARTMENT_HEAD'\|\|\(u\.role==='TEACHER'&&u\.teacherDesignations\?\.includes\('CLASS_ADVISER'\)\)/);
 assert.match(routes,/if\(!requester\(req\.auth\)\)return res\.status\(403\)/);
 assert.match(routes,/\/batches\/:id\/review',authenticateSchoolClient,admin/);
 assert.match(routes,/await permitted\(db,u,e\)/);
 assert.match(routes,/await permitted\(db,req\.auth,e\)/);
 assert.match(routes,/sy|year_status/);
 assert.match(routes,/new Set\(ids\)\.size!==ids\.length/);
 assert.match(routes,/ids\.length>200/);
});
test('server reports per-learner reasons and revalidates before submission',()=>{
 for(const code of ['NO_ACTIVE_ENROLLMENT','OUT_OF_SCOPE','PENDING','NOT_ASSIGNED','UNCHANGED','ELIGIBLE'])
   assert.ok(routes.includes(code),code);
 assert.match(routes,/for\(const id of p\.ids\)items\.push\(await evaluate/);
 assert.match(routes,/if\(!eligible\.length\)/);
 assert.match(routes,/const e=await getEnrollment\(db,req\.auth\.schoolId,i\.enrollmentId\)/);
 assert.match(routes,/ON CONFLICT DO NOTHING RETURNING request_id/);
 assert.match(routes,/await db\.query\('ROLLBACK'\)/);
 assert.match(routes,/SPECIAL_PROGRAM_BATCH_REQUEST_SUBMITTED/);
});
test('admin bulk review verifies matching pending IDs and commits an all-or-nothing selected group',()=>{
 assert.match(routes,/SELECT \* FROM special_program_change_requests WHERE school_id=\$1 AND batch_id=\$2 AND request_id=ANY\(\$3::uuid\[\]\) AND status='PENDING' ORDER BY request_id FOR UPDATE/);
 assert.match(routes,/result\.rowCount!==ordered\.length/);
 assert.match(routes,/for\(const item of result\.rows\)/);
 assert.match(routes,/await change\(db,req\.auth,e,item\.action,item\.requested_program_type_id\)/);
 assert.match(routes,/SPECIAL_PROGRAM_BATCH_/);
 assert.match(routes,/SPECIAL_PROGRAM_REQUEST_/);
 assert.match(routes,/await db\.query\('COMMIT'\)/);
 assert.match(routes,/await db\.query\('ROLLBACK'\)/);
});
test('Department Head/Class Adviser roster selection opens a preview instead of changing enrollment',()=>{
 assert.match(portal,/value="REQUEST_PROGRAM">Request special-program change/);
 for(const id of ['specialProgramBatchModal','specialProgramBatchForm','specialProgramBatchPreview','specialProgramBatchPreviewRows','specialProgramBatchSubmit','specialProgramBatchReviewList'])
   assert.ok(portal.includes('id="'+id+'"'),id);
 assert.match(main,/option\.value === 'REQUEST_PROGRAM'/);
 assert.match(main,/teacherHas\('CLASS_ADVISER'\)/);
 assert.match(main,/attendigo:program-batch-open/);
 assert.match(batchUi,/\/api\/special-programs\/requests\/bulk\/preview/);
 assert.match(batchUi,/\/api\/special-programs\/requests\/bulk'/);
 assert.match(batchUi,/\/api\/special-programs\/batches\//);
 assert.match(batchUi,/previewSignature!==signature\(\)/);
 assert.match(batchUi,/data-program-batch-check/);
 assert.match(batchUi,/data-admin-pick/);
 assert.match(batchUi,/data-admin-batch-decision/);
 assert.match(batchUi,/document\.dispatchEvent\(new Event\('attendigo:requests-changed'\)\)/);
});
test('service worker uses same versions for portal and batch assets',()=>{
 for(const name of ['portal.js','special-program-ui.js','special-program-ui.css','special-program-batch-ui.js']){
   const p=[...portal.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).find(value=>value.startsWith('/'+name+'?v='));
   assert.ok(p,name+' must be referenced by portal');
   assert.ok(worker.includes(JSON.stringify(p)),p+' must match worker');
 }
 assert.match(worker,/const CACHE = "attendigo-v\\d+-[a-z0-9-]+"/);
});
