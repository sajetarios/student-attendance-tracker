'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {FILTERS,STATUS_LABELS,canUseInbox,scopeFor,actionExpression,publicInboxRecord,notifyLeaveTransition}=require('../staff-leave-inbox');
const {assertCachedAsset}=require('./support/asset-contract');
const schoolId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staffId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const departmentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const requestId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const admin={role:'SCHOOL_ADMIN',schoolId,userId:actorId,departmentId:null};
const head={role:'DEPARTMENT_HEAD',schoolId,userId:actorId,departmentId};
const teacher={role:'TEACHER',schoolId,userId:actorId,departmentId};
const request={
 request_id:requestId,school_id:schoolId,staff_user_id:staffId,requester_role:'TEACHER',
 staff_name:'Fictional Teacher',department_id:departmentId,department_name:'English',
 status:'PENDING_HEAD',leave_type:'SICK',credit_account:'VSC',
 start_date:'2026-11-23',end_date:'2026-11-24',
 submitted_at:'2026-11-23T00:00:00Z',reason:'Sensitive medical detail',
 details:'Sensitive detail',head_note:null,admin_note:null
};
test('reviewer inbox is restricted to school and department roles',()=>{
 assert.equal(canUseInbox('SCHOOL_ADMIN'),true);
 assert.equal(canUseInbox('DEPARTMENT_HEAD'),true);
 assert.equal(canUseInbox('TEACHER'),false);
 assert.equal(canUseInbox('GATE_KEEPER'),false);
 assert.equal(FILTERS.includes('ACTION'),true);
 assert.equal(STATUS_LABELS.PENDING_EXTERNAL,'Awaiting Official Approval');
 assert.equal(STATUS_LABELS.REJECTED,'Disapproved');
 assert.throws(()=>scopeFor(teacher));
});
test('scoping enforces school and department and excludes unauthorized own approvals',()=>{
 const adminScope=scopeFor(admin);
 assert.deepEqual(adminScope.args,[schoolId]);
 assert.match(adminScope.where,/r.school_id=\$1/);
 const headScope=scopeFor(head);
 assert.deepEqual(headScope.args,[schoolId,departmentId]);
 assert.match(headScope.where,/r.department_id=\$2/);
 assert.match(headScope.where,/u.role='SCHOOL_ADMIN'/);
 const args=[...headScope.args];
 const action=actionExpression(head,args);
 assert.match(action,/r.staff_user_id<>\$3/);
 assert.match(action,/r.department_id=\$4/);
 assert.deepEqual(args,[schoolId,departmentId,actorId,departmentId]);
 const adminArgs=[schoolId];
 assert.match(actionExpression(admin,adminArgs),/r.status IN \('PENDING_ADMIN','PENDING_EXTERNAL'\)/);
 assert.equal(adminArgs[1],actorId);
});
test('no medical information or applicant reasons leak into reviewer inbox records',()=>{
 const safe=publicInboxRecord(request,head);
 assert.equal(safe.requestId,requestId);
 assert.equal(safe.actions.recommend,true);
 assert.equal(safe.leaveType,null);
 assert.equal(safe.creditAccount,null);
 assert.equal(Object.hasOwn(safe,'reason'),false);
 assert.equal(Object.hasOwn(safe,'details'),false);
 assert.equal(JSON.stringify(safe).includes('Sensitive'),false);
 const self=publicInboxRecord({...request,staff_user_id:actorId},head);
 assert.equal(self.actions.recommend,false);
 const principal=publicInboxRecord({...request,status:'PENDING_EXTERNAL',requester_role:'SCHOOL_ADMIN',department_id:null},head);
 assert.equal(principal.actions.recordOfficialDecision,true);
 assert.equal(publicInboxRecord({...request,status:'APPROVED'},admin).actions.recordOfficialDecision,false);
});
test('notifications are transactional and never disclose illness details',async()=>{
 const calls=[];
 const tx={async query(sql,args){calls.push({sql,args});return {rows:[]};}};
 const opts={schoolId,requestId,staffUserId:staffId,departmentId,requesterRole:'TEACHER'};
 await notifyLeaveTransition(tx,{...opts,status:'PENDING_HEAD'});
 assert.equal(calls.length,2);
 assert.match(calls[0].sql,/attendigo_notify/);
 assert.match(calls[1].sql,/role='DEPARTMENT_HEAD'/);
 assert.match(calls[1].sql,/u.department_id=\$9/);
 assert.equal(calls[1].args[8],departmentId);
 assert.equal(calls[1].args[7],staffId);
 assert.equal(calls[0].args[7],'/portal.html#leaveManagement');
 assert.equal(JSON.stringify(calls).includes('medical'),false);
 calls.length=0;
 await notifyLeaveTransition(tx,{...opts,status:'PENDING_ADMIN'});
 assert.match(calls[1].sql,/u.role='SCHOOL_ADMIN'/);
 calls.length=0;
 await notifyLeaveTransition(tx,{...opts,requesterRole:'SCHOOL_ADMIN',status:'PENDING_EXTERNAL'});
 assert.match(calls[1].sql,/u.role='DEPARTMENT_HEAD'/);
 calls.length=0;
 await notifyLeaveTransition(tx,{...opts,status:'APPROVED'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].args[6],'APPROVED');
 calls.length=0;
 await notifyLeaveTransition(tx,{...opts,status:'REJECTED'});
 assert.equal(calls.length,1);
});
test('new approval inbox does not mutate Gatekeeper, OB, original DTR or Form48 calculations',()=>{
 const api=fs.readFileSync('staff-leave-inbox-routes.js','utf8');
 const policy=fs.readFileSync('staff-leave-inbox.js','utf8');
 const server=fs.readFileSync('server.js','utf8');
 assert.match(server,/registerStaffLeaveInboxRoutes\(app, pool/);
 assert.match(api,/requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD'\)/);
 assert.match(api,/countsOnly/);
 assert.match(api,/actionExpression/);
 assert.match(api,/LIMIT \$'/);
 assert.doesNotMatch(api,/\b(INSERT|UPDATE|DELETE)\b/i);
 assert.doesNotMatch(policy,/\b(INSERT|UPDATE|DELETE)\b/i);
 assert.match(fs.readFileSync('staff-leave-routes.js','utf8'),/notifyLeaveTransition/);
 const ui=fs.readFileSync('public/staff-leave-ui.js','utf8');
 assert.match(ui,/data-leave-tab="inbox"/);
 assert.match(ui,/AttendigoLeaveInbox.render/);
});
test('PWA, notification deep links and role-specific inbox assets are wired',()=>{
 const html=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 const note=fs.readFileSync('public/universal-notifications.js','utf8');
 assertCachedAsset(html,sw,'staff-leave-ui.js',{minimumVersion:4});
 assertCachedAsset(html,sw,'leave-approval-inbox.js',{minimumVersion:1});
 assertCachedAsset(html,sw,'leave-approval-inbox.css',{minimumVersion:1});
 assertCachedAsset(html,sw,'universal-notifications.js',{minimumVersion:6});
 assert.match(note,/view==='leaveManagement'/);
 assert.match(note,/click\('staffLeaveReviewNav'\)/);
 assert.match(note,/click\('staffLeaveNav'\)/);
 assert.match(fs.readFileSync('public/leave-approval-inbox.js','utf8'),/Needs my review/);
 assert.match(fs.readFileSync('public/leave-approval-inbox.js','utf8'),/Awaiting official approval/);
 assert.match(fs.readFileSync('public/staff-leave-ui.js','utf8'),/openLeave\(reviewQueue=false\)/);
});
