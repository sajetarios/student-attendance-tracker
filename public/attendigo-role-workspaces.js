'use strict';
// Presentation only: the role and all authorized modules remain owned by portal.js.
(() => {
 const roles={
  SCHOOL_ADMIN:{name:'School administration',label:'SCHOOL MANAGEMENT',title:'School operations',description:'Manage enrollment, accounts, schedules and pending school requests.',first:'adminDashboardCard'},
  DEPARTMENT_HEAD:{name:'Department leadership',label:'DEPARTMENT WORKSPACE',title:'Department priorities',description:'Review teacher coverage, department schedules and work that needs attention.',first:'departmentHeadOverview'},
  TEACHER:{name:'Teaching workspace',label:'TEACHING TOOLS',title:'My teaching day',description:'Review your timetable, assigned learners and confirmed class attendance.'},
  GATE_KEEPER:{name:'Gatekeeper workspace',label:'GATE OPERATIONS',title:'Gate verification',description:'Scan authorized learner and staff QR badges, then verify the registered photo.'}
 };
 const $=id=>document.getElementById(id);
 function init(user){
  const role=user?.role,config=roles[role],layout=document.querySelector('.portal-layout');
  if(!config||!layout||layout.getAttribute('data-attendigo-role')!==role)return;
  $('axStaffWorkspaceName').textContent=config.name;
  $('axStaffNavigationLabel').textContent=config.label;
  $('axStaffDashboardKicker').textContent=config.label;
  $('axStaffDashboardTitle').textContent=config.title;
  $('axStaffDashboardDescription').textContent=config.description;
  // Prioritize the already-authorized role card above auxiliary modules. Move the
  // original node, keeping its identity, hidden state, event handlers and data.
  const card=$(config.first),intro=$('axStaffDashboardIntro');
  if(card&&intro&&card.parentElement===intro.parentElement&&intro.nextElementSibling!==card)intro.after(card);
  if(role==='GATE_KEEPER'){
   const scanner=$('studentScannerCard');
   if(scanner)scanner.setAttribute('data-ax-gate-workspace','true');
  }
 }
 if(window.attendigoStaffIdentity?.then)window.attendigoStaffIdentity.then(init).catch(()=>{});
})();
