'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {assertCachedAsset}=require('./support/asset-contract');
test('missing scan alerts use transactional, tenant and department scoped routing with pending backfill',()=>{
 const sql=fs.readFileSync('migrations/088_missing_scan_notifications.sql','utf8');
 assert.match(sql,/AFTER INSERT OR UPDATE OF status ON staff_missing_scan_requests/);
 assert.match(sql,/u\.school_id=r\.school_id AND u\.active=TRUE/);
 assert.match(sql,/u\.role='DEPARTMENT_HEAD' AND u\.department_id=r\.department_id/);
 assert.match(sql,/r\.requester_role='DEPARTMENT_HEAD' AND u\.role='PRINCIPAL'/);
 assert.match(sql,/SELECT attendigo_missing_scan_pending\(school_id,request_id\)/);
 assert.doesNotMatch(sql,/INSERT INTO staff_attendance_events|UPDATE staff_attendance_events/);
});
test('bell routes directly to the correct missing scan dialog and refreshes after mutations',()=>{
 const js=fs.readFileSync('public/universal-notifications.js','utf8'),ui=fs.readFileSync('public/missing-scan-ui.js','utf8');
 assert.match(js,/module\.open\(null,item\.requestId\)/);
 assert.match(js,/await navigate\(item\)/);
 assert.match(ui,/api\(id\?'\/requests\/'\+encodeURIComponent\(id\)/);
 assert.match(ui,/tab=result\.view/);
 assert.match(ui,/Selected request/);
 assert.match(ui,/msBackToList/);
 assert.match(ui,/AttendigoMissingScansReady/);
 assert.match(ui,/window\.AttendigoMissingScans=\{open\}/);
 assert.match(ui,/attendigo:requests-changed/);
 const sw=fs.readFileSync('public/sw.js','utf8');
 for(const p of ['portal.html','principal.html']){
  const html=fs.readFileSync('public/'+p,'utf8');
  assertCachedAsset(html,sw,'missing-scan-ui.js',{minimumVersion:6});
  assertCachedAsset(html,sw,'universal-notifications.js',{minimumVersion:10});
 }
});
