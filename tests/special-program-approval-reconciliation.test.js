'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const routes=read('special-program-routes.js');
const batchRoutes=read('special-program-batch-routes.js');
const admin=read('public/academic-admin.js');
const ui=read('public/special-program-ui.js');
const batchUi=read('public/special-program-batch-ui.js');
const portal=read('public/portal.html');
const worker=read('public/sw.js');

test('already-satisfied program requests approve without writing duplicate primary assignments',()=>{
  assert.match(routes,/async function change\(c,u,e,action,programTypeId,\{allowAlreadySatisfied=false\}=\{\}\)/);
  assert.match(routes,/if\(action==='ASSIGN'&&previous\.rows\.some[\s\S]*?if\(allowAlreadySatisfied\)return \{applied:false\}/);
  assert.match(routes,/if\(action==='REMOVE'&&!previous\.rowCount\)\{if\(allowAlreadySatisfied\)return \{applied:false\}/);
  assert.match(routes,/const outcome=await change\(c,req\.auth,e,item\.action,item\.requested_program_type_id,\{allowAlreadySatisfied:true\}\)/);
  assert.match(routes,/JSON\.stringify\(\{studentId:item\.student_id,action:item\.action,alreadySatisfied\}\)/);
  assert.match(batchRoutes,/const alreadySatisfiedIds=\[\]/);
  assert.match(batchRoutes,/const outcome=await change\(db,req\.auth,e,item\.action,item\.requested_program_type_id,\{allowAlreadySatisfied:true\}\)/);
  assert.match(batchRoutes,/alreadySatisfied:alreadySatisfiedIds\.length,applied:/);
  assert.match(batchRoutes,/SPECIAL_PROGRAM_REQUEST_/);
  assert.match(batchRoutes,/SPECIAL_PROGRAM_BATCH_/);
  assert.match(batchRoutes,/await db\.query\('ROLLBACK'\)/);
});
test('School Admin direct bulk set primary skips unchanged learners; row action follows the same audited route',()=>{
  assert.match(routes,/const changed=\[\],unchanged=\[\]/);
  assert.match(routes,/outcome\.applied\?changed:unchanged/);
  assert.match(routes,/unchangedCount:unchanged\.length/);
  assert.match(admin,/api\('\/api\/special-programs\/assignments\/bulk'/);
  assert.doesNotMatch(admin,/api\('\/api\/enrollments\/'\+e\.enrollmentId\+'\/programs'/);
  assert.match(ui,/already correct/);
  assert.match(ui,/const byEnrollment=new Map/);
  assert.match(portal,/id="specialProgramAssignSelected"[^>]+>Set primary for selected/);
});
test('pending approvals are prominent, already-set statuses are marked, and reviewed batches collapse into history',()=>{
  assert.ok(portal.indexOf('id="specialProgramReviewPanel"')<portal.indexOf('id="academicSelectedYear"'));
  assert.match(portal,/1 · Pending special-program approvals/);
  assert.match(batchUi,/currentProgramTypeId===item\.programTypeId/);
  assert.match(batchUi,/Already set/);
  assert.match(batchUi,/special-program-reviewed-history/);
  assert.match(batchUi,/result\.alreadySatisfied/);
  assert.match(batchUi,/data-admin-select-all/);
  assert.match(routes,/AS \\"currentProgramTypeId\\"/);
});
test('updated School Admin program assets match service-worker cache references',()=>{
  for(const name of ['academic-admin.js','special-program-ui.js','special-program-ui.css','special-program-batch-ui.js']){
    const assets=[...portal.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
    const asset=assets.find(url=>url.startsWith('/'+name+'?v='));
    assert.ok(asset,name+' present in portal');
    assert.ok(worker.includes(JSON.stringify(asset)),name+' cache version matches portal');
  }
});