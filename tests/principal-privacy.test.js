'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('School Admin has no Principal preview and separate SDO coordination',()=>{
 const portal=read('public/portal.html'), principal=read('public/principal.html');
 assert.doesNotMatch(portal,/Preview Principal Dashboard|href="\/principal\.html"/i);
 assert.match(portal,/href="\/admin-sdo-coordination\.html"/);
 assert.doesNotMatch(principal,/id="principalSdoAdminPanel"/);
 const admin=read('public/admin-sdo-coordination.html');
 assert.match(admin,/principalSdoHandoffForm/);assert.match(admin,/principalSdoDecisionForm/);
 const script=read('public/admin-sdo-coordination.js');
 assert.match(script,/user\?\.role!=='SCHOOL_ADMIN'/);
 assert.doesNotMatch(script,/\/api\/principal\/(overview|class-impact|workspace)/);
 assert.match(script,/\/api\/principal\/sdo-requests/);
});
test('Principal leadership APIs and HTML reject all non-Principal roles',()=>{
 for(const p of ['principal-overview-routes.js','principal-class-impact-routes.js','principal-workspace-routes.js']){
  assert.match(read(p),/requireSchoolRoles\('PRINCIPAL'\)/);
  assert.doesNotMatch(read(p),/requireSchoolRoles\([^)]*SCHOOL_ADMIN/);
 }
 const server=read('server.js');
 assert.match(server,/app\.get\('\/principal\.html', authenticateSchoolClient, requireSchoolRoles\('PRINCIPAL'\)/);
 assert.match(server,/app\.get\('\/admin-sdo-coordination\.html', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(read('public/principal-dashboard.js'),/data\.user\?\.role!=='PRINCIPAL'/);
 assert.match(read('public/sw.js'),/\/principal\.html", "\/school-memos\.html", "\/admin-sdo-coordination\.html"/);
});
