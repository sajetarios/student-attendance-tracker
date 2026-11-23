'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const route=read('staff-leave-routes.js');
const inbox=read('staff-leave-inbox.js');
const inboxRoutes=read('staff-leave-inbox-routes.js');
const ui=read('public/leave-approval-inbox.js');
const staffUi=read('public/staff-leave-ui.js');
const form6=read('public/leave-form6.js');
const sql=read('migrations/083_department_declined_leave_workflow.sql');
const {FILTERS,STATUS_LABELS,publicInboxRecord,notifyLeaveTransition}=require('../staff-leave-inbox');
const {allowReviewer}=require('../staff-leave-policy');

test('negative department recommendation closes internal routing, positive one still advances',()=>{
 assert.match(route,/step==='HEAD'\?\(decision==='REJECT'\?'DECLINED_HEAD':'PENDING_ADMIN'\):'PENDING_EXTERNAL'/);
 assert.match(route,/LEAVE_\+'\+step\+'\+_REVIEWED/);
 assert.match(route,/notifyLeaveTransition/);
 assert.match(route,/status NOT IN \(\\'REJECTED\\',\\'CANCELLED\\',\\'DECLINED_HEAD\\'\)/);
 assert.doesNotMatch(route,/decision==='REJECT'\?'REJECTED'/);
});
test('department decline is not actionable by admin or final-official-decision roles',()=>{
 const r={staff_user_id:'applicant',department_id:'dept',requester_role:'TEACHER',status:'DECLINED_HEAD'};
 assert.equal(allowReviewer('SCHOOL_ADMIN','admin',null,r,'ADMIN'),false);
 assert.equal(allowReviewer('SCHOOL_ADMIN','admin',null,r,'EXTERNAL'),false);
 assert.equal(allowReviewer('DEPARTMENT_HEAD','head','dept',r,'HEAD'),false);
 assert.equal(STATUS_LABELS.DECLINED_HEAD,'Declined by Department Head');
 assert.equal(FILTERS.includes('DECLINED'),true);
 const rec=publicInboxRecord({request_id:'req',staff_user_id:'applicant',staff_name:'Example',
  requester_role:'TEACHER',status:'DECLINED_HEAD'}, {role:'SCHOOL_ADMIN',userId:'admin',departmentId:null});
 assert.equal(Object.values(rec.actions).some(Boolean),false);
});
test('declined requests have a separate closed filter, not pending, official disapproved, or credits',()=>{
 assert.match(inboxRoutes,/DECLINED_HEAD:'declined'/);
 assert.match(inboxRoutes,/DECLINED:'DECLINED_HEAD'/);
 assert.match(inboxRoutes,/if\(x.status.startsWith\('PENDING_'\)\)counts.pending/);
 assert.match(inbox,/DECLINED_HEAD:'Declined by Department Head'/);
 assert.match(ui,/Declined by department/);
 assert.match(staffUi,/\['APPROVED','REJECTED','DECLINED_HEAD','CANCELLED'\]/);
 assert.match(form6,/not endorsed by Department Head/i);
 assert.match(sql,/DECLINED_HEAD/);
 assert.doesNotMatch(sql,/(teacher_gate_events|staff_attendance_events|staff_form48_approved_leaves|staff_leave_credit_entries)/);
});
test('department decline only notifies applicant; no new admin review notification',async()=>{
 const calls=[];const client={query:async(q,args)=>{calls.push({q,args});return {rows:[]};}};
 await notifyLeaveTransition(client,{schoolId:'school',staffUserId:'staff',requestId:'req',
  departmentId:'dept',requesterRole:'TEACHER',status:'DECLINED_HEAD'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].args[6],'DECLINED_HEAD');
 assert.match(calls[0].args[4],/not endorsed/i);
 assert.doesNotMatch(JSON.stringify(calls),/school review requested/i);
});
