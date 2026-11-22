/* Attendigo lunch duty navigation: display only the server-confirmed presenter duty.
   This script does not grant QR privileges and does not touch attendance or DTR. */
(() => {
 'use strict';
 const link=document.getElementById('teacherLunchQrNav');
 const group=document.getElementById('assignedDutiesNavGroup');
 if(!link||!group)return;
 let sequence=0;
 function display(assigned){
   const visible=assigned===true;
   const wasHidden=group.hidden;
   link.dataset.presenterAuthorized=String(visible);
   link.hidden=!visible;
   group.hidden=!visible;
   // Expand when a newly verified duty first appears, but preserve manual
   // section collapse on subsequent background or page visibility checks.
   if(visible&&wasHidden){
     const toggle=group.querySelector('.nav-group-toggle');
     const submenu=group.querySelector('.nav-submenu');
     if(toggle)toggle.setAttribute('aria-expanded','true');
     if(submenu)submenu.hidden=false;
   }
 }
 async function assignedForSlot(slot){
   const response=await fetch('/api/staff-attendance/lunch/presenter?slot='+encodeURIComponent(slot),{
     method:'GET',credentials:'same-origin',cache:'no-store'
   });
   if(!response.ok)throw Error('Presenter assignment unavailable');
   const result=await response.json();
   return result?.isCurrentPresenter===true;
 }
 function init(user){
   if(user?.role!=='TEACHER')return;
   display(false);
   async function refresh(){
     const current=++sequence;
     if(document.hidden)return;
     // The two lunch slots are independently assigned. An assigned teacher
     // must remain able to open their duty even if only one slot is assigned.
     const results=await Promise.allSettled([
       assignedForSlot('AM_OUT'),assignedForSlot('PM_IN')
     ]);
     if(current!==sequence)return;
     display(results.some(result=>result.status==='fulfilled'&&result.value===true));
   }
   void refresh();
   window.addEventListener('pageshow',()=>{void refresh();});
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
   document.addEventListener('attendigo:requests-changed',()=>{void refresh();});
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
