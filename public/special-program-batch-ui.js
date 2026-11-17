/* Batch special-program requests and grouped approvals; all eligibility decisions are server enforced. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const modal=$('specialProgramBatchModal'),groupHost=$('specialProgramBatchReviewList');
 if(!modal&&!groupHost)return;
 const user=(()=>{try{return JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'null');}catch{return null;}})();
 const admin=user?.role==='SCHOOL_ADMIN';
 const canRequest=user?.role==='DEPARTMENT_HEAD'||(user?.role==='TEACHER'&&user.teacherDesignations?.includes('CLASS_ADVISER'));
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(id||''));
 const api=async(path,options={})=>{
   const token=sessionStorage.getItem('schoolAttendance.accessToken');
   if(!token)throw Error('Your school session expired. Sign in again.');
   const response=await fetch(path,{...options,cache:'no-store',headers:{
     Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to complete request.');
   return data;
 };
 const confirmAction=async(message,title)=>{
   if(window.AppDialog?.confirm)return window.AppDialog.confirm(message,{title,confirmText:'Confirm'});
   return window.confirm(message);
 };
 function feedback(id,text,error=false){
   const el=$(id);if(!el)return;
   el.textContent=text;el.classList.toggle('error',error);
 }
 let selected=[],preview=null,previewSignature='',catalog=[],busy=false,loadingGroups=false;
 function signature(){
   return [selected.map(s=>s.enrollmentId).join(','),$('specialProgramBatchAction')?.value,$('specialProgramBatchProgram')?.value].join('|');
 }
 function close(){
   modal.hidden=true;selected=[];preview=null;previewSignature='';
   $('specialProgramBatchForm')?.reset();
   $('specialProgramBatchPreviewRows')?.replaceChildren();
   $('specialProgramBatchSummary').textContent='';
   $('specialProgramBatchSubmit').disabled=true;
 }
 function invalidate(){
   preview=null;previewSignature='';
   $('specialProgramBatchPreviewRows').replaceChildren();
   $('specialProgramBatchSummary').textContent='';
   $('specialProgramBatchSubmit').disabled=true;
   feedback('specialProgramBatchFeedback','Review selected learners again before submitting.');
 }
 function toggleProgram(){
   const assign=$('specialProgramBatchAction').value==='ASSIGN';
   $('specialProgramBatchProgramWrap').hidden=!assign;
   $('specialProgramBatchProgram').required=assign;
   invalidate();
 }
 async function loadPrograms(){
   const result=await api('/api/special-programs/catalog-access');
   catalog=(result.programs||[]).filter(p=>p.active);
   const select=$('specialProgramBatchProgram');
   select.replaceChildren();
   const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose an active program';
   select.append(placeholder);
   for(const item of catalog){
     const opt=document.createElement('option');opt.value=item.programTypeId;
     opt.textContent=item.code+' · '+item.name;select.append(opt);
   }
 }
 function markSelection(){
   const submit=$('specialProgramBatchSubmit');
   const n=[...modal.querySelectorAll('[data-program-batch-check]:checked')].length;
   const total=preview?.eligible||0;
   submit.disabled=!n||busy||previewSignature!==signature()||$('specialProgramBatchReason').value.trim().length<3;
   submit.textContent=n?'Submit '+n+' eligible request'+(n===1?'':'s'):'No eligible requests to submit';
   $('specialProgramBatchSummary').textContent=preview
     ?preview.selected+' selected · '+total+' eligible · '+preview.skipped+' skipped · '+n+' included in this request'
     :'';
 }
 function renderPreview(){
   const items=preview?.items||[],names=new Map(selected.map(s=>[s.enrollmentId,s]));
   const host=$('specialProgramBatchPreviewRows');
   if(!items.length){host.textContent='No enrollments to preview.';return;}
   host.innerHTML=items.map(item=>{
     const student=names.get(item.enrollmentId);
     const display=student?.fullName||'Selected learner';
     const placement=student?[student.gradeLevel,student.section].filter(Boolean).join(' · '):'';
     const tag=item.eligible?'Eligible':'Skipped';
     return '<label class="special-batch-preview-row '+(item.eligible?'eligible':'ineligible')+'">'+
       '<input type="checkbox" data-program-batch-check value="'+esc(item.enrollmentId)+'" '+(item.eligible?'checked':'disabled')+'>'+
       '<span class="special-batch-preview-identity"><strong>'+esc(display)+'</strong><small>'+esc(placement)+' · '+esc(student?.studentId||'')+'</small></span>'+
       '<span class="special-batch-eligibility '+(item.eligible?'ok':'skip')+'">'+tag+'</span>'+
       '<small class="special-batch-preview-reason">'+esc(item.reason)+'</small></label>';
   }).join('');
   markSelection();
 }
 async function open(event){
   if(!canRequest||busy)return;
   const learners=event.detail?.students||[];
   if(!learners.length||learners.length>200)return feedback('bulkQrFeedback','Select 1–200 learners before requesting a program change.',true);
   selected=learners.map(s=>({...s,enrollmentId:String(s.enrollmentId||'')}));
   preview=null;previewSignature='';
   $('specialProgramBatchForm').reset();
   modal.hidden=false;
   $('specialProgramBatchTitle').textContent='Request a program change · '+selected.length+' learners';
   $('specialProgramBatchSummary').textContent='';
   $('specialProgramBatchPreviewRows').replaceChildren();
   $('specialProgramBatchSubmit').disabled=true;
   feedback('specialProgramBatchFeedback','Choose a program, review the eligibility of each learner, then submit the eligible group.');
   toggleProgram();
   try{busy=true;await loadPrograms();}catch(error){feedback('specialProgramBatchFeedback',error.message,true);}
   finally{busy=false;}
   $('specialProgramBatchAction').focus();
 }
 async function requestPreview(){
   if(!canRequest||busy)return;
   const action=$('specialProgramBatchAction').value,pid=$('specialProgramBatchProgram').value;
   if(action==='ASSIGN'&&!pid)return feedback('specialProgramBatchFeedback','Choose an active program first.',true);
   const known=selected.filter(s=>validId(s.enrollmentId));
   if(!known.length)return feedback('specialProgramBatchFeedback','Selected learners have no active enrollment ID. Ask School Admin to enroll them.',true);
   const missing=selected.filter(s=>!validId(s.enrollmentId));
   busy=true;$('specialProgramBatchPreview').disabled=true;
   try{
     const result=await api('/api/special-programs/requests/bulk/preview',{method:'POST',body:JSON.stringify({
       enrollmentIds:known.map(s=>s.enrollmentId),action,programTypeId:action==='ASSIGN'?pid:null
     })});
     preview={...result,items:[...result.items,...missing.map(s=>({
       enrollmentId:s.enrollmentId,eligible:false,reason:'No active enrollment ID on the current student roster.'
     }))],selected:selected.length,skipped:result.skipped+missing.length};
     previewSignature=signature();
     renderPreview();
     feedback('specialProgramBatchFeedback',preview.eligible
       ?'Review eligible learners below. Skipped learners will not be submitted.':'None of the selected learners can be submitted.',!preview.eligible);
   }catch(error){invalidate();feedback('specialProgramBatchFeedback',error.message,true);}
   finally{busy=false;$('specialProgramBatchPreview').disabled=false;markSelection();}
 }
 async function submit(event){
   event.preventDefault();
   if(!canRequest||busy||!preview||previewSignature!==signature())return;
   const ids=[...modal.querySelectorAll('[data-program-batch-check]:checked')].map(x=>x.value);
   if(!ids.length)return;
   const reason=$('specialProgramBatchReason').value.trim();
   if(reason.length<3||reason.length>1000)return feedback('specialProgramBatchFeedback','Give a reason of 3–1000 characters.',true);
   const action=$('specialProgramBatchAction').value,pid=$('specialProgramBatchProgram').value;
   if(!await confirmAction('Submit '+ids.length+' eligible learner requests for School Admin approval? This does not immediately change their primary programs.','Submit batch program request'))return;
   busy=true;markSelection();
   try{
     const result=await api('/api/special-programs/requests/bulk',{method:'POST',body:JSON.stringify({
       enrollmentIds:ids,action,programTypeId:action==='ASSIGN'?pid:null,reason
     })});
     close();
     const skipped=result.skipped?.length||0;
     feedback('bulkQrFeedback',result.submitted+' special-program requests sent for admin approval'+(skipped?' · '+skipped+' became ineligible':'')+'.');
     document.dispatchEvent(new Event('attendigo:requests-changed'));
   }catch(error){feedback('specialProgramBatchFeedback',error.message,true);invalidate();}
   finally{busy=false;markSelection();}
 }
 function renderGroups(rows){
   const batches=new Map();
   for(const row of rows){
     if(!validId(row.batchId))continue;
     if(!batches.has(row.batchId))batches.set(row.batchId,[]);
     batches.get(row.batchId).push(row);
   }
   if(!batches.size){groupHost.innerHTML='<p class="field-hint">No grouped special-program requests yet.</p>';return;}
   const groups=[...batches.entries()].sort((a,b)=>Number(b[1].some(x=>x.status==='PENDING'))-Number(a[1].some(x=>x.status==='PENDING')));
   const pendingGroups=groups.filter(([,items])=>items.some(x=>x.status==='PENDING'));
   const reviewedGroups=groups.filter(([,items])=>items.every(x=>x.status!=='PENDING'));
   const renderList=entries=>entries.map(([id,items])=>{
     const pending=items.filter(x=>x.status==='PENDING'),first=items[0],code=first.programCode||first.programName||'primary program';
     const title=first.action==='REMOVE'?'Remove special-program assignment':'Assign '+code;
     const history=items.filter(x=>x.status!=='PENDING').length;
     return '<section class="special-batch-admin-group" data-admin-batch="'+esc(id)+'">'+
       '<div class="special-batch-admin-head"><div><strong>'+esc(title)+'</strong><small>'+esc(first.requestedBy||'')+' · '+esc(first.schoolYear||'')+' · '+pending.length+' pending · '+history+' reviewed</small></div>'+
       '<span class="special-program-status '+(pending.length?'pending':'approved')+'">'+(pending.length?'Awaiting review':'Reviewed')+'</span></div>'+
       '<p class="special-batch-admin-reason">'+esc(first.reason||'')+'</p>'+
       (pending.length?'<label class="special-batch-select-all"><input type="checkbox" data-admin-select-all checked> Select all pending learners in this batch</label>':'')+
       '<div class="special-batch-admin-learners">'+items.map(item=>{
         const alreadySet=item.status==='PENDING'&&((item.action==='ASSIGN'&&item.currentProgramTypeId===item.programTypeId)||(item.action==='REMOVE'&&!item.currentProgramTypeId));
         return '<label class="special-batch-admin-student"><input type="checkbox" data-admin-pick="'+esc(item.requestId)+'" '+(item.status==='PENDING'?'checked':'disabled')+'>'+
         '<span><strong>'+esc(item.studentName||item.studentId)+'</strong><small>'+esc(item.gradeLevel||'')+' · '+esc(item.section||'')+'</small></span>'+
         '<span class="special-program-status '+esc(item.status.toLowerCase())+'">'+esc(item.status)+'</span>'+(alreadySet?'<span class="special-program-status satisfied" title="Requested assignment already exists. Approval will close the request without reassigning.">Already set</span>':'')+'</label>';}).join('')+'</div>'+
       (pending.length?'<label class="special-batch-review-note">Optional review note<textarea data-admin-review-note maxlength="1000" rows="2" placeholder="Reason or decision notes"></textarea></label>'+
         '<div class="special-program-review-actions"><button type="button" class="primary-button" data-admin-batch-decision="APPROVE" data-admin-batch-id="'+esc(id)+'">Approve selected</button>'+
         '<button type="button" class="outline-button" data-admin-batch-decision="REJECT" data-admin-batch-id="'+esc(id)+'">Reject selected</button></div>':'')+
       '<p class="inline-feedback" data-admin-batch-feedback role="status"></p></section>';
   }).join('');
   groupHost.innerHTML=(pendingGroups.length?renderList(pendingGroups):'<p class="field-hint">No pending grouped requests.</p>')+(reviewedGroups.length?'<details class="special-program-reviewed-history"><summary>Reviewed batches ('+reviewedGroups.length+')</summary>'+renderList(reviewedGroups)+'</details>':'');
 }
 async function loadGroups(){
   if(!admin||!groupHost||loadingGroups)return;
   loadingGroups=true;
   try{
     const r=await api('/api/special-programs/requests');
     renderGroups(r.requests||[]);
   }catch(error){groupHost.textContent=error.message;}
   finally{loadingGroups=false;}
 }
 async function adminClick(event){
   const selectAll=event.target.closest('[data-admin-select-all]');
   if(selectAll){
     const group=selectAll.closest('[data-admin-batch]');
     for(const input of group.querySelectorAll('[data-admin-pick]:not(:disabled)'))input.checked=selectAll.checked;
     return;
   }
   const button=event.target.closest('[data-admin-batch-decision]');
   if(!button||button.disabled)return;
   const group=button.closest('[data-admin-batch]'),id=button.dataset.adminBatchId,decision=button.dataset.adminBatchDecision;
   const ids=[...group.querySelectorAll('[data-admin-pick]:checked')].map(i=>i.dataset.adminPick);
   const feedbackEl=group.querySelector('[data-admin-batch-feedback]');
   if(!ids.length){feedbackEl.textContent='Select at least one pending learner first.';return;}
   const note=group.querySelector('[data-admin-review-note]').value.trim();
   const verb=decision==='APPROVE'?'Approve':'Reject';
   if(!await confirmAction(verb+' '+ids.length+' pending requests? Decisions are audited and approved assignments update official enrollment.','Review special-program batch'))return;
   for(const control of group.querySelectorAll('[data-admin-batch-decision]'))control.disabled=true;
   try{
     const result=await api('/api/special-programs/batches/'+encodeURIComponent(id)+'/review',{
       method:'POST',body:JSON.stringify({decision,requestIds:ids,reviewNote:note})
     });
     const summary=result.reviewed+' requests '+result.status.toLowerCase()+'.'+(result.alreadySatisfied?' '+result.alreadySatisfied+' already correct (no duplicate assignment).':'');
     await loadGroups();
     document.dispatchEvent(new Event('attendigo:requests-changed'));
     feedback('specialProgramReviewFeedback',summary);
     if(window.AppDialog?.alert)await window.AppDialog.alert(summary,{title:'Batch review completed',eyebrow:'SUCCESS',confirmText:'Done'});
   }catch(error){
     feedbackEl.textContent=error.message+' No decisions were applied to this selected group.';
     for(const control of group.querySelectorAll('[data-admin-batch-decision]'))control.disabled=false;
   }
 }
 function start(){
   if(canRequest){
     document.addEventListener('attendigo:program-batch-open',open);
     $('specialProgramBatchClose')?.addEventListener('click',close);
     $('specialProgramBatchCancel')?.addEventListener('click',close);
     $('specialProgramBatchAction')?.addEventListener('change',toggleProgram);
     $('specialProgramBatchProgram')?.addEventListener('change',invalidate);
     $('specialProgramBatchReason')?.addEventListener('input',markSelection);
     $('specialProgramBatchPreview')?.addEventListener('click',requestPreview);
     $('specialProgramBatchForm')?.addEventListener('submit',submit);
     $('specialProgramBatchPreviewRows')?.addEventListener('change',markSelection);
     modal?.addEventListener('click',event=>{if(event.target===modal)close();});
   }
   if(admin&&groupHost){
     $('academicAdminNav')?.addEventListener('click',loadGroups);
     $('specialProgramReviewRefresh')?.addEventListener('click',loadGroups);
     document.addEventListener('attendigo:requests-changed',loadGroups);
     groupHost.addEventListener('click',adminClick);
     groupHost.addEventListener('change',event=>{
       if(!event.target.matches('[data-admin-pick]'))return;
       const group=event.target.closest('[data-admin-batch]'),all=group?.querySelector('[data-admin-select-all]');
       if(!all)return;
       const picks=[...group.querySelectorAll('[data-admin-pick]:not(:disabled)')];
       all.checked=picks.every(p=>p.checked);
       all.indeterminate=picks.some(p=>p.checked)&&!all.checked;
     });
     loadGroups();
   }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
