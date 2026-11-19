'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const html=read('portal.html'),admin=read('admin-request-notifications.js'),portal=read('portal.js');
const universal=read('universal-notifications.js'),css=read('admin-approval-navigation.css'),sw=read('sw.js');
test('single visible bell in header, existing approval badges and APIs preserved',()=>{
 assert.match(universal,/class="universal-bell"/);
 assert.match(admin,/wrap\.classList\.add\('admin-approval-sidebar-owned'\)/);
 assert.match(admin,/wrap\.hidden=true/);
 assert.match(css,/#adminNotificationWrap\.admin-approval-sidebar-owned\{display:none!important\}/);
 for(const id of ['adminRequestsNavBadge','adminNotificationCount','adminStudentRequestCount','adminGuardianRequestCount','adminPhotoRequestCount','adminProgramRequestCount']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(admin,/\/api\/student-portal\/requests/);
 assert.match(admin,/\/api\/guardians\/requests/);
 assert.match(admin,/\/api\/photos\/requests/);
 assert.match(admin,/\/api\/special-programs\/requests/);
});
test('original approval review UI is moved into sidebar-owned workspace not deleted',()=>{
 for(const id of ['adminApprovalSidebarPanel','adminNotificationPanel','adminPhotoReview','adminPhotoReviewList','adminStudentRequestsShortcut','adminGuardianRequestsShortcut','adminProgramRequestsShortcut','adminPhotoRequestsShortcut']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(admin,/inboxHost\.append\(panel\)/);
 assert.match(admin,/photoApi\('/);
 assert.match(admin,/window\.AttendigoGuardian\?\.openApprovals/);
 assert.match(admin,/attendigo:open-approval-inbox/);
 assert.match(portal,/attendigo:open-approval-inbox/);
});
test('sidebar remains school admin-only; deep links and notification center stay distinct',()=>{
 assert.match(portal,/requestsApprovalsNav'\)\.hidden = !admin/);
 assert.match(portal,/if \(user\?\.role !== 'SCHOOL_ADMIN'\) return;/);
 assert.match(portal,/params\.get\('panel'\) === 'requests'/);
 assert.match(universal,/\/api\/notifications/);
 assert.match(admin,/getUser\(\)\?\.role==='SCHOOL_ADMIN'/);
});
test('no permission, attendance or OB logic changes in this UI release',()=>{
 assert.doesNotThrow(()=>new vm.Script(admin));
 assert.doesNotThrow(()=>new vm.Script(portal));
 assert.match(admin,/method:'POST'/);
 assert.match(admin,/document\.dispatchEvent\(new CustomEvent\('attendigo:requests-changed'\)\)/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
});
test('PWA cache and page assets updated coherently',()=>{
 for(const asset of ['admin-request-notifications.js?v=6','portal.js?v=209','admin-approval-navigation.css?v=1']){
  assert.ok(html.includes(asset),asset+' in page');
  assert.ok(sw.includes(asset),asset+' in service worker');
 }
 assert.match(sw,/attendigo-v254-unified-approval-nav/);
});
