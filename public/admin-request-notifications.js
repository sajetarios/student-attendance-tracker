/* Attendigo: School Admin approval inbox — on-page polling, no background push. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const wrap=$('adminNotificationWrap'), bell=$('adminNotificationBell'),panel=$('adminNotificationPanel');
 if(!wrap||!bell||!panel)return;
 const getUser=()=>{try{return JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'null');}catch{return null;}};
 const isAdmin=()=>getUser()?.role==='SCHOOL_ADMIN';
 const api=async path=>{
   const token=sessionStorage.getItem('schoolAttendance.accessToken');
   if(!token)throw Error('Your school session has expired.');
   const response=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load school requests.');
   return data;
 };
 let fetching=false,studentPending=0,guardianPending=0;
 function render(){
   const total=studentPending+guardianPending;
   const badge=$('adminNotificationCount');
   badge.hidden=total===0;
   badge.textContent=String(total>99?'99+':total);
   $('adminStudentRequestCount').textContent=String(studentPending);
   $('adminGuardianRequestCount').textContent=String(guardianPending);
   bell.setAttribute('aria-label',total?total+' pending school approval requests':'No pending school approval requests');
   bell.title=total?total+' requests awaiting your review':'School approval inbox';
   $('adminNotificationFoot').textContent=total
     ? total+' pending '+(total===1?'request':'requests')+' · Open a category to review.'
     : 'All caught up — no pending requests.';
 }
 async function refresh(){
   if(!isAdmin()||fetching)return;
   fetching=true;
   const trigger=$('adminNotificationRefresh');
   if(trigger)trigger.disabled=true;
   try{
     const [studentResult,guardianResult]=await Promise.allSettled([
       api('/api/student-portal/requests'),api('/api/guardians/requests')
     ]);
     let errors=[];
     if(studentResult.status==='fulfilled'){
       studentPending=(studentResult.value.requests||[]).filter(r=>r.status==='PENDING').length;
     }else errors.push('Student requests unavailable');
     if(guardianResult.status==='fulfilled'){
       guardianPending=(guardianResult.value.requests||[]).filter(r=>r.status==='PENDING').length;
     }else errors.push('Guardian requests unavailable');
     render();
     if(errors.length)$('adminNotificationFoot').textContent=errors.join(' · ')+'. Tap ↻ to retry.';
   }finally{fetching=false;if(trigger)trigger.disabled=false;}
 }
 const close=()=>{panel.hidden=true;bell.setAttribute('aria-expanded','false');};
 bell.addEventListener('click',()=>{
   if(!isAdmin())return;
   panel.hidden=!panel.hidden;
   bell.setAttribute('aria-expanded',String(!panel.hidden));
   if(!panel.hidden)refresh();
 });
 $('adminNotificationRefresh')?.addEventListener('click',refresh);
 $('adminStudentRequestsShortcut')?.addEventListener('click',()=>{
   close();
   const nav=$('studentAccountsNav');
   if(nav&&!nav.hidden)nav.click();
 });
 $('adminGuardianRequestsShortcut')?.addEventListener('click',()=>{
   close();
   if(window.AttendigoGuardian?.openApprovals)window.AttendigoGuardian.openApprovals();
   else $('guardianApprovalsNav')?.click();
 });
 document.addEventListener('pointerdown',event=>{
   if(!panel.hidden&&!wrap.contains(event.target))close();
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();bell.focus();}});
 document.addEventListener('attendigo:requests-changed',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('focus',refresh);
 const start=()=>{
   if(!isAdmin())return;
   wrap.hidden=false;
   refresh();
   window.setInterval(()=>{if(!document.hidden)refresh();},45000);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
