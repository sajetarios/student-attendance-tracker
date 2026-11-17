/* Attendigo special-program workflow — respects server-scoped roles and enrollment IDs. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('studentRows')||!$('academicEnrollmentRows'))return;
  const user=(()=>{try{return JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'null');}catch{return null;}})();
  const role=user?.role,admin=role==='SCHOOL_ADMIN';
  const canRequest=role==='DEPARTMENT_HEAD'||(role==='TEACHER'&&user?.teacherDesignations?.includes('CLASS_ADVISER'));
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const api=async(path,options={})=>{
    const token=sessionStorage.getItem('schoolAttendance.accessToken');
    if(!token)throw Error('Sign in again to manage special programs.');
    const r=await fetch(path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(j.error||'Request failed.');
    return j;
  };
  const message=(id,value,error=false)=>{if($(id)){$(id).textContent=value;$(id).classList.toggle('error',error);}};
  const confirmAction=async(text,title)=>{
    if(window.AppDialog?.confirm)return window.AppDialog.confirm(text,{title,confirmText:'Confirm',variant:'primary'});
    return false; // never bypass the shared confirmation UI
  };
  let catalog=[],requestable=new Set(),enrollments=new Map(),selected=new Set(),activeEnrollment=null;
  let adminLoading=false,requestLoading=false,enrollmentLoading=false;
  const programOptions=()=>{
    const active=catalog.filter(p=>p.active);
    for(const select of [$('specialProgramBulkType'),$('specialProgramRequestProgram')]){
      if(!select)continue;
      const old=select.value;
      select.replaceChildren();
      const empty=document.createElement('option');
      empty.value='';empty.textContent='Choose an active special program';select.append(empty);
      for(const p of active){const option=document.createElement('option');option.value=p.programTypeId;option.textContent=p.code+' · '+p.name;select.append(option);}
      if(active.some(p=>p.programTypeId===old))select.value=old;
    }
  };
  async function loadCatalog(){
    if(!(admin||canRequest))return;
    const data=await api('/api/special-programs/catalog-access');
    catalog=data.programs||[];programOptions();
  }
  const year=()=>$('academicSelectedYear')?.value||'';
  async function loadEnrollmentMap(){
    if(!admin||!year()){enrollments.clear();selected.clear();return;}
    if(enrollmentLoading)return;
    enrollmentLoading=true;
    const wanted=year();
    try{
      const data=await api('/api/school-years/'+encodeURIComponent(wanted)+'/enrollments');
      if(year()!==wanted)return;
      enrollments=new Map((data.enrollments||[]).map(e=>[String(e.studentId),e]));
      selected.clear();decorateEnrollments();
    }finally{enrollmentLoading=false;}
  }
  function decorateEnrollments(){
    if(!admin)return;
    const host=$('academicEnrollmentRows');if(!host)return;
    for(const row of host.querySelectorAll('tr')){
      if(row.querySelector('input[data-special-enroll]'))continue;
      if(row.querySelector('td[colspan]'))continue;
      const first=row.querySelector('td');if(!first)return;
      const item=enrollments.get(first.textContent.trim());
      if(!item)continue;
      const cell=document.createElement('td');
      const input=document.createElement('input');
      input.type='checkbox';input.dataset.specialEnroll=item.enrollmentId;
      input.setAttribute('aria-label','Select '+item.fullName+' for special program assignment');
      input.checked=selected.has(item.enrollmentId);
      input.addEventListener('change',()=>{
        if(input.checked)selected.add(item.enrollmentId);else selected.delete(item.enrollmentId);
        updateSelectedCount();
      });
      cell.append(input);row.prepend(cell);
    }
    updateSelectedCount();
  }
  function updateSelectedCount(){
    message('specialProgramBulkFeedback',selected.size+' learner'+(selected.size===1?'':'s')+' selected for direct assignment. Maximum 200 per batch.');
    $('specialProgramAssignSelected').disabled=!selected.size||!$('specialProgramBulkType').value;
    $('specialProgramRemoveSelected').disabled=!selected.size;
  }
  const refreshAcademic=async()=>{
    const picker=$('academicSelectedYear');
    if(!picker)return;
    picker.dispatchEvent(new Event('change',{bubbles:true}));
    await loadEnrollmentMap();
  };
  async function runBulk(action){
    if(!admin)return;
    const ids=[...selected],programTypeId=$('specialProgramBulkType')?.value;
    if(!ids.length)return message('specialProgramBulkFeedback','Select at least one learner.',true);
    if(ids.length>200)return message('specialProgramBulkFeedback','Select no more than 200 learners per batch.',true);
    if(action==='ASSIGN'&&!programTypeId)return message('specialProgramBulkFeedback','Choose the special program first.',true);
    const program=catalog.find(p=>p.programTypeId===programTypeId);
    const title=action==='ASSIGN'?'Set primary program in bulk':'Remove primary program in bulk';
    const byEnrollment=new Map([...enrollments.values()].map(e=>[e.enrollmentId,e]));
    const same=ids.filter(id=>{const current=(byEnrollment.get(id)?.programs||[]).find(p=>p.primary)?.programTypeId||null;return action==='ASSIGN'?String(current||'')===String(programTypeId):!current;}).length;
    const toChange=ids.length-same;
    const summary=ids.length+' selected · '+toChange+' to update · '+same+' already '+(action==='ASSIGN'?'assigned':'without a primary program')+'.';
    if(!await confirmAction(summary+'\n'+(action==='ASSIGN'?'Set '+(program?.code||'the selected program')+' as primary?':'Remove current primary programs?')+' Unchanged learners will be skipped. Existing approvals will remain available in the review panel.',title))return;
    for(const id of ['specialProgramAssignSelected','specialProgramRemoveSelected'])$(id).disabled=true;
    try{
      const r=await api('/api/special-programs/assignments/bulk',{method:'POST',body:JSON.stringify({action,enrollmentIds:ids,programTypeId:action==='ASSIGN'?programTypeId:null})});
      selected.clear();message('specialProgramBulkFeedback',r.count+' updated · '+(r.unchangedCount||0)+' already correct. Review any outstanding change requests in the approval panel above.');
      await refreshAcademic();
      document.dispatchEvent(new Event('attendigo:requests-changed'));
    }catch(e){message('specialProgramBulkFeedback',e.message,true);}
    finally{for(const id of ['specialProgramAssignSelected','specialProgramRemoveSelected'])$(id).disabled=false;}
  }
  function reviewsTable(items,adminView){
    const individual = adminView ? items.filter(item=>!item.batchId) : items;
    if(!individual.length)return '<p class="field-hint">No individual special-program requests found.</p>';
    return individual.map(item=>{
      const title=item.action==='REMOVE'?'Remove primary program':'Assign '+(item.programCode||item.programName||'program');
      const actions=adminView&&item.status==='PENDING'
       ?'<div class="special-program-review-actions"><button type="button" class="primary-button" data-program-review="APPROVE" data-request-id="'+esc(item.requestId)+'">Approve</button><button type="button" class="outline-button" data-program-review="REJECT" data-request-id="'+esc(item.requestId)+'">Reject</button></div>':'';
      return '<article class="special-program-review-row"><div><strong>'+esc(item.studentName)+' · '+esc(title)+'</strong><small>'+esc(item.gradeLevel)+' · '+esc(item.section)+' · '+esc(item.schoolYear)+' · '+esc(item.requestedBy)+'</small><p>'+esc(item.reason)+'</p>'+(item.reviewNote?'<p>Review: '+esc(item.reviewNote)+'</p>':'')+'</div><span class="special-program-status '+esc(item.status.toLowerCase())+'">'+esc(item.status)+'</span>'+actions+'</article>';
    }).join('');
  }
  async function loadAdminRequests(){
    if(!admin||adminLoading)return;
    adminLoading=true;
    try{const d=await api('/api/special-programs/requests');$('specialProgramReviewList').innerHTML=reviewsTable(d.requests||[],true);message('specialProgramReviewFeedback',(d.requests||[]).filter(x=>x.status==='PENDING').length+' awaiting review');}
    catch(e){message('specialProgramReviewFeedback',e.message,true);}
    finally{adminLoading=false;}
  }
  async function loadMyRequests(){
    if(!canRequest||requestLoading)return;
    requestLoading=true;
    try{const d=await api('/api/special-programs/requests');$('mySpecialProgramRequestsList').innerHTML=reviewsTable(d.requests||[],false);}
    catch(e){$('mySpecialProgramRequestsList').textContent=e.message;}
    finally{requestLoading=false;}
  }
  async function loadRequestable(){
    if(!canRequest)return;
    try{
      const [r]=await Promise.all([api('/api/special-programs/requestable'),loadCatalog()]);
      requestable=new Set(r.enrollmentIds||[]);decorateTeacherRows();
      $('mySpecialProgramRequests').hidden=false;
      await loadMyRequests();
    }catch(e){$('mySpecialProgramRequestsList').textContent=e.message;}
  }
  function decorateTeacherRows(){
    if(!canRequest||!requestable.size)return;
    const host=$('studentRows');
    for(const row of host.querySelectorAll('tr[data-student-enrollment]')){
      const id=row.dataset.studentEnrollment;
      if(!requestable.has(id)||row.querySelector('[data-request-special]'))continue;
      const cell=row.querySelector('[data-label="Special program"]');if(!cell)continue;
      const button=document.createElement('button');
      button.type='button';button.className='special-program-request-link';
      button.textContent='Request change';button.dataset.requestSpecial=id;
      button.addEventListener('click',()=>openRequest(id,row.dataset.studentName));
      cell.append(button);
    }
  }
  function closeRequest(){$('specialProgramRequestModal').hidden=true;activeEnrollment=null;$('specialProgramRequestForm').reset();message('specialProgramRequestFeedback','');}
  async function openRequest(id,name){
    if(!canRequest||!requestable.has(id))return;
    activeEnrollment=id;
    $('specialProgramRequestStudent').textContent=name||'Selected learner';
    if(!catalog.length){try{await loadCatalog();}catch(e){return message('specialProgramRequestFeedback',e.message,true);}}
    $('specialProgramRequestAction').value='ASSIGN';toggleRequestProgram();
    $('specialProgramRequestModal').hidden=false;
    $('specialProgramRequestReason').focus();
  }
  function toggleRequestProgram(){
    const assigning=$('specialProgramRequestAction').value==='ASSIGN';
    $('specialProgramRequestProgramWrap').hidden=!assigning;
    $('specialProgramRequestProgram').required=assigning;
  }
  async function submitRequest(e){
    e.preventDefault();
    if(!activeEnrollment||!canRequest)return;
    const action=$('specialProgramRequestAction').value;
    const programTypeId=$('specialProgramRequestProgram').value;
    const reason=$('specialProgramRequestReason').value.trim();
    if(action==='ASSIGN'&&!programTypeId)return message('specialProgramRequestFeedback','Choose a program.',true);
    if(reason.length<3)return message('specialProgramRequestFeedback','Explain your request.',true);
    $('specialProgramRequestSubmit').disabled=true;
    try{
      await api('/api/special-programs/requests',{method:'POST',body:JSON.stringify({enrollmentId:activeEnrollment,action,programTypeId:action==='ASSIGN'?programTypeId:null,reason})});
      closeRequest();await loadMyRequests();
      document.dispatchEvent(new Event('attendigo:requests-changed'));
    }catch(error){message('specialProgramRequestFeedback',error.message,true);}
    finally{$('specialProgramRequestSubmit').disabled=false;}
  }
  const init=async()=>{
    if(admin){
      const academicRows=$('academicEnrollmentRows');
      new MutationObserver(()=>{
        if(!enrollments.size && year() && !enrollmentLoading)
          loadEnrollmentMap().catch(e=>message('specialProgramBulkFeedback',e.message,true));
        else decorateEnrollments();
      }).observe(academicRows,{childList:true});
      $('academicSelectedYear')?.addEventListener('change',()=>loadEnrollmentMap().catch(e=>message('specialProgramBulkFeedback',e.message,true)));
      $('academicAdminNav')?.addEventListener('click',()=>{loadCatalog().catch(e=>message('specialProgramBulkFeedback',e.message,true));loadEnrollmentMap().catch(e=>message('specialProgramBulkFeedback',e.message,true));loadAdminRequests();});
      $('specialProgramBulkType')?.addEventListener('change',updateSelectedCount);
      $('specialProgramSelectVisible')?.addEventListener('click',()=>{
        const eligible=[...enrollments.values()].filter(e=>e.status==='ENROLLED');
        const ids=eligible.map(e=>e.enrollmentId).slice(0,200);
        selected=new Set(ids);
        for(const checkbox of academicRows.querySelectorAll('[data-special-enroll]'))checkbox.checked=selected.has(checkbox.dataset.specialEnroll);
        updateSelectedCount();
        if(eligible.length>200)message('specialProgramBulkFeedback','First 200 enrolled learners selected. Use smaller batches to assign all learners.');
      });
      $('specialProgramAssignSelected')?.addEventListener('click',()=>runBulk('ASSIGN'));
      $('specialProgramRemoveSelected')?.addEventListener('click',()=>runBulk('REMOVE'));
      $('specialProgramReviewRefresh')?.addEventListener('click',loadAdminRequests);
      $('specialProgramReviewList')?.addEventListener('click',async e=>{
        const button=e.target.closest('[data-program-review]');if(!button||button.disabled)return;
        const decision=button.dataset.programReview,id=button.dataset.requestId;
        if(!await confirmAction((decision==='APPROVE'?'Approve':'Reject')+' this requested program change?',decision==='APPROVE'?'Approve enrollment change':'Reject program request'))return;
        button.disabled=true;
        try{
          const outcome=await api('/api/special-programs/requests/'+encodeURIComponent(id)+'/review',{method:'POST',body:JSON.stringify({decision})});
          await loadAdminRequests();
          if(outcome.alreadySatisfied)message('specialProgramReviewFeedback','Approved and reconciled: this learner already had the requested program. No duplicate assignment was created.');await refreshAcademic();
          document.dispatchEvent(new Event('attendigo:requests-changed'));
        }catch(error){message('specialProgramReviewFeedback',error.message,true);}
        finally{button.disabled=false;}
      });
      $('adminProgramRequestsShortcut')?.addEventListener('click',()=>{
        $('adminNotificationBell')?.click();
        $('academicAdminNav')?.click();
        $('specialProgramReviewPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
      });
      await loadCatalog().catch(e=>message('specialProgramBulkFeedback',e.message,true));
      loadAdminRequests();
    }
    if(canRequest){
      $('mySpecialRequestsRefresh')?.addEventListener('click',loadMyRequests);
      $('specialProgramRequestClose')?.addEventListener('click',closeRequest);
      $('specialProgramRequestCancel')?.addEventListener('click',closeRequest);
      $('specialProgramRequestAction')?.addEventListener('change',toggleRequestProgram);
      $('specialProgramRequestForm')?.addEventListener('submit',submitRequest);
      $('specialProgramRequestModal')?.addEventListener('click',event=>{if(event.target===$('specialProgramRequestModal'))closeRequest();});
      $('studentsNav')?.addEventListener('click',()=>loadRequestable());
      new MutationObserver(decorateTeacherRows).observe($('studentRows'),{childList:true});
      await loadRequestable();
    }
    document.addEventListener('attendigo:requests-changed',()=>{if(admin)loadAdminRequests();else if(canRequest)loadMyRequests();});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});
  else init().catch(console.error);
})();
