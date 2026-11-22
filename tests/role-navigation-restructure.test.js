'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync('public/'+p,'utf8');
const html=read('portal.html'),portal=read('portal.js');
const workspace=read('simplified-workspace.js'),leave=read('staff-leave-ui.js');
const ob=read('staff-ob-ui.js'),presenter=read('attendigo-presenter-nav.js');
const sw=read('sw.js');

test('Teacher: one expanded My Classes group with Planner; OB and leave in My Attendance',()=>{
 assert.match(workspace,/move\('plannerNav', 'people'\)/);
 assert.match(portal,/relocate\('plannerNav', 'people'\)/);
 assert.match(portal,/relocate\('officialBusinessNav', 'personalAttendance'\)/);
 assert.match(portal,/relocate\('teacherLunchQrNav', 'assignedDuties'\)/);
 assert.match(workspace,/label\('people', 'My Classes'\)/);
 assert.match(workspace,/label\('personalAttendance', 'My Attendance'\)/);
 assert.match(leave,/user\.role==='SCHOOL_ADMIN'\?'operations':'personalAttendance'/);
 assert.doesNotMatch(workspace,/collapseOtherGroups/);
});
test('Department Head gets a separate reviewer queue while preserving personal OB and leave',()=>{
 assert.match(workspace,/label\('people', 'Department Management'\)/);
 assert.match(workspace,/label\('operations', 'Requests & Approvals'\)/);
 assert.match(workspace,/move\('officialBusinessNav', 'personalAttendance'\)/);
 assert.match(ob,/if\(user\.role==='DEPARTMENT_HEAD'\)/);
 assert.match(ob,/id='obDepartmentReviewNav'/);
 assert.match(ob,/setScope\('department'\)/);
 assert.match(leave,/id='staffLeaveReviewNav'/);
 assert.match(leave,/r\.status==='PENDING_HEAD'/);
 assert.match(leave,/r\.staffRole==='SCHOOL_ADMIN'/);
});
test('School Admin keeps management queues separate from physical attendance',()=>{
 assert.match(workspace,/move\('requestsApprovalsNav', 'operations'\)/);
 assert.match(workspace,/move\('myGateAttendanceNav', 'attendanceManagement'\)/);
 assert.match(workspace,/move\('lunchQrAdminNav', 'attendanceManagement'\)/);
 assert.match(workspace,/move\('officialBusinessNav', 'operations'\)/);
 assert.match(workspace,/label\('settings', 'School Settings'\)/);
 assert.match(leave,/const visibleRequests=reviewOnly\?/);
 assert.match(leave,/reviewerNav\?\.addEventListener\('click',\(\)=>openLeave\(true\)\)/);
});
test('Assigned Duties is only a navigation presentation and never bypasses presenter verification',()=>{
 assert.match(html,/id="assignedDutiesNavGroup" hidden/);
 assert.match(html,/data-nav-group="assignedDuties"/);
 assert.match(presenter,/\/api\/staff-attendance\/lunch\/presenter\?slot=/);
 assert.match(presenter,/result\?\.isCurrentPresenter===true/);
 assert.match(portal,/dataset\.presenterAuthorized !== 'true'/);
 assert.doesNotMatch(presenter,/method:'POST'|method:'PUT'|method:'DELETE'|localStorage/);
 assert.match(presenter,/window\.attendigoStaffIdentity\?\.then\(init\)/);
});
test('Presenter entry is hidden for unassigned teachers and visible for either assigned lunch slot',async()=>{
 async function check(am,pm){
  const toggle={state:null,setAttribute(name,value){if(name==='aria-expanded')this.state=value;}};
  const submenu={hidden:true};
  const group={hidden:true,querySelector(q){return q==='.nav-group-toggle'?toggle:submenu;}};
  const link={hidden:false,dataset:{}};
  const requests=[];
  const document={
   hidden:false,
   getElementById(id){return id==='teacherLunchQrNav'?link:id==='assignedDutiesNavGroup'?group:null;},
   addEventListener(){}
  };
  const window={attendigoStaffIdentity:Promise.resolve({role:'TEACHER'}),addEventListener(){}};
  vm.runInNewContext(presenter,{
   document,window,encodeURIComponent,fetch:async url=>{
    requests.push(url);
    return {ok:true,json:async()=>({isCurrentPresenter:url.includes('AM_OUT')?am:pm})};
   }
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(link.hidden,!(am||pm));
  assert.equal(group.hidden,!(am||pm));
  assert.equal(link.dataset.presenterAuthorized,String(am||pm));
  assert.equal(requests.length,2);
  return {toggle,submenu};
 }
 await check(false,false);
 const {toggle,submenu}=await check(false,true);
 assert.equal(toggle.state,'true');
 assert.equal(submenu.hidden,false);
});
test('No new attendance routes; assets match the 305 cache and mobile sidebar stays scrollable',()=>{
 const css=read('attendigo-sidebar-adaptive.css');
 for(const asset of ['/portal.js?v=234','/simplified-workspace.js?v=4','/staff-leave-ui.js?v=4',
  '/staff-ob-ui.js?v=6','/attendigo-presenter-nav.js?v=1']){
  assert.ok(html.includes(asset),asset+' HTML');
  assert.ok(sw.includes('"'+asset+'"'),asset+' shell');
 }
 assert.match(sw,/attendigo-v309-guide-accuracy/);
 assert.match(css,/-webkit-overflow-scrolling:touch/);
 assert.match(css,/overflow-y:auto/);
 assert.doesNotMatch(leave,/INSERT INTO|UPDATE staff_attendance_events|\/api\/gate\/record/);
});
