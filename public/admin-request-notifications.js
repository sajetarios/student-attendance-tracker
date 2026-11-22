/* Attendigo: School Admin approval inbox — on-page polling, no background push. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const wrap=$('adminNotificationWrap'), bell=$('adminNotificationBell'),panel=$('adminNotificationPanel');
 if(!wrap||!bell||!panel)return;
 const getUser=()=>{try{return JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'null');}catch{return null;}};
 const isAdmin=()=>getUser()?.role==='SCHOOL_ADMIN';
 const api=async path=>{

   const response=await fetch(path,{cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load school requests.');
   return data;
 };
 let pendingRefresh,photoLoadError=false,studentPending=0,guardianPending=0,photoPending=0,programPending=0,photoRequests=[];
 function render(){
   const total=studentPending+guardianPending+photoPending+programPending;
   const badge=$('adminNotificationCount');
   badge.hidden=total===0;
   badge.textContent=String(total>99?'99+':total);
   const menuBadge=$('adminRequestsNavBadge');
   if(menuBadge){menuBadge.hidden=total===0;menuBadge.textContent=String(total>99?'99+':total);}
   $('adminStudentRequestCount').textContent=String(studentPending);
   $('adminGuardianRequestCount').textContent=String(guardianPending);
   $('adminPhotoRequestCount').textContent=String(photoPending);
   if($('adminProgramRequestCount'))$('adminProgramRequestCount').textContent=String(programPending);
   bell.setAttribute('aria-label',total?total+' pending school approval requests':'No pending school approval requests');
   bell.title=total?total+' requests awaiting your review':'School approval inbox';
   $('adminNotificationFoot').textContent=total
     ? total+' pending '+(total===1?'request':'requests')+' · Open a category to review.'
     : 'All caught up — no pending requests.';
 }
 function refresh(){
   if(!isAdmin())return;
   if(!pendingRefresh)pendingRefresh=loadRequests().finally(()=>{pendingRefresh=null;});
   return pendingRefresh;
 }
 async function loadRequests(){
   const trigger=$('adminNotificationRefresh');
   if(trigger)trigger.disabled=true;
   try{
     const [studentResult,guardianResult,photoResult,programResult]=await Promise.allSettled([
       api('/api/student-portal/requests'),api('/api/guardians/requests'),api('/api/photos/requests'),api('/api/special-programs/requests')
     ]);
     let errors=[];
     if(studentResult.status==='fulfilled'){
       studentPending=(studentResult.value.requests||[]).filter(r=>r.status==='PENDING').length;
     }else errors.push('Student requests unavailable');
     if(guardianResult.status==='fulfilled'){
       guardianPending=(guardianResult.value.requests||[]).filter(r=>r.status==='PENDING').length;
     }else errors.push('Guardian requests unavailable');
     photoLoadError=photoResult.status==='rejected';
     if(!photoLoadError){
       photoRequests=(photoResult.value.requests||[]);
       photoPending=photoRequests.length;
     }else errors.push('Photo requests unavailable');
     if(programResult.status==='fulfilled')programPending=(programResult.value.requests||[]).filter(r=>r.status==='PENDING').length;
     else errors.push('Program requests unavailable');
     render();
     if(errors.length)$('adminNotificationFoot').textContent=errors.join(' · ')+'. Tap ↻ to retry.';
   }finally{if(trigger)trigger.disabled=false;}
 }
 const close=()=>{panel.hidden=true;bell.setAttribute('aria-expanded','false');if(inboxHost)inboxHost.hidden=true;};
 bell.addEventListener('click',()=>{
   if(!isAdmin())return;
   panel.hidden=!panel.hidden;
   bell.setAttribute('aria-expanded',String(!panel.hidden));
   if(!panel.hidden)refresh();
 });
 $('adminNotificationRefresh')?.addEventListener('click',async()=>{
   await refresh();
   if(!reviewPanel.hidden)showPhotoList();
 });
 $('adminStudentRequestsShortcut')?.addEventListener('click',()=>{
   close();
   // Open the account tab inside the unified Students workspace.
   $('studentAccountsTab')?.click();
 });
 const reviewPanel=$('adminPhotoReview'),reviewList=$('adminPhotoReviewList');
 const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const photoApi=async(path,options={})=>{

   const response=await fetch(path,{...options,headers:{...(options.headers||{})},cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Unable to review photo.');
   return result;
 };
 let previewUrl=null;
 const clearPreview=()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}};
 const showPhotoList=()=>{
   clearPreview();
   reviewPanel.hidden=false;
   if(photoLoadError){reviewList.textContent='Could not load photo requests. Refresh the inbox to try again.';return;}
   reviewList.innerHTML=photoRequests.length?photoRequests.map(request=>
     '<article class="admin-photo-request-row"><div><strong>'+escapeText(request.subjectName||request.subjectId)+'</strong><small>'+escapeText(request.subjectKind==='STAFF'?'Staff photo':'Student photo')+'</small></div>'+
     '<div class="admin-photo-actions"><button type="button" data-photo-preview="'+escapeText(request.requestId)+'">Preview</button><button type="button" data-photo-decision="APPROVED" data-photo-id="'+escapeText(request.requestId)+'">Approve</button><button type="button" data-photo-decision="REJECTED" data-photo-id="'+escapeText(request.requestId)+'">Reject</button></div></article>'
   ).join(''):'<p class="admin-notification-foot">No pending photo requests.</p>';
 };
 $('adminPhotoRequestsShortcut')?.addEventListener('click',async()=>{
   if(!isAdmin())return;
   openInbox();
   reviewPanel.hidden=false;
   reviewList.textContent='Loading photo requests…';
   reviewPanel.scrollIntoView({block:'nearest'});
   try{await refresh();if(!reviewPanel.hidden)showPhotoList();}catch(e){reviewList.textContent=e.message;reviewPanel.hidden=false;}
 });
 $('adminPhotoReviewClose')?.addEventListener('click',()=>{reviewPanel.hidden=true;clearPreview();});
 reviewList?.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button||button.disabled)return;
   const id=button.dataset.photoPreview||button.dataset.photoId;
   if(!id||!photoRequests.some(r=>r.requestId===id))return;
   if(button.dataset.photoPreview){
     button.disabled=true;
     try{

       const response=await fetch('/api/photos/requests/'+encodeURIComponent(id)+'/preview',{cache:'no-store'});
       if(!response.ok)throw Error('Photo preview unavailable.');
       clearPreview();previewUrl=URL.createObjectURL(await response.blob());
       let img=reviewList.querySelector('.admin-photo-preview');
       if(!img){img=document.createElement('img');img.className='admin-photo-preview';img.alt='Submitted profile photo for review';button.closest('article').append(img);}
       img.src=previewUrl;
     }catch(e){alert(e.message);}finally{button.disabled=false;}
     return;
   }
   const decision=button.dataset.photoDecision;
   if(!['APPROVED','REJECTED'].includes(decision))return;
   if(!window.confirm((decision==='APPROVED'?'Approve':'Reject')+' this profile photo request?'))return;
   const actions=button.closest('article').querySelectorAll('button');actions.forEach(b=>b.disabled=true);
   try{
     await photoApi('/api/photos/requests/'+encodeURIComponent(id)+'/review',{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})
     });
     photoRequests=photoRequests.filter(r=>r.requestId!==id);photoPending=photoRequests.length;
     render();showPhotoList();document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
   }catch(e){alert(e.message);actions.forEach(b=>b.disabled=false);}
 });
 $('adminGuardianRequestsShortcut')?.addEventListener('click',()=>{
   close();
   if(window.AttendigoGuardian?.openApprovals)window.AttendigoGuardian.openApprovals();
   else $('guardianApprovalsNav')?.click();
 });
 document.addEventListener('pointerdown',event=>{
   if(!panel.hidden && !wrap.contains(event.target) && !(inboxHost && inboxHost.contains(event.target)))close();
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();bell.focus();}});
 document.addEventListener('attendigo:requests-changed',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('focus',refresh);
 const inboxHost=$('adminApprovalSidebarPanel');
 const closeInbox=()=>{
   panel.hidden=true;
   bell.setAttribute('aria-expanded','false');
   inboxHost?.setAttribute('hidden','');
 };
 const openInbox=()=>{
   if(!isAdmin()||!inboxHost)return;
   if(document.getElementById('dashboardView')?.hidden){
     document.querySelector('.nav-item[data-view="dashboard"]')?.click();
   }
   wrap.hidden=true; // keep the redundant header action hidden
   if(panel.parentNode!==inboxHost)inboxHost.append(panel);
   inboxHost.hidden=false;
   panel.hidden=false;
   bell.setAttribute('aria-expanded','true');
   refresh();
   inboxHost.scrollIntoView({block:'nearest',behavior:'smooth'});
 };
 document.addEventListener('attendigo:open-approval-inbox',openInbox);
 $('adminApprovalSidebarClose')?.addEventListener('click',closeInbox);
 const start=()=>{
   if(!isAdmin())return;
   // The approval inbox now belongs to the Requests & Approvals sidebar.
   // Keep the original secure review panel and polling, but do not display a second header icon.
   wrap.classList.add('admin-approval-sidebar-owned');
   wrap.hidden=true;
   panel.hidden=true;
   bell.setAttribute('aria-expanded','false');
   refresh();
   if(location.hash==='#photoApprovals')$('adminPhotoRequestsShortcut')?.click();
   window.setInterval(()=>{if(!document.hidden)refresh();},45000);
 };
 window.attendigoStaffIdentity.then(start);
})();
