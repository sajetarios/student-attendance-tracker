(() => {
  'use strict';
  // Independent enhancement: never block the existing portal's data loading.
  const $ = id => document.getElementById(id);
  const getUser = () => { try { return JSON.parse(sessionStorage.getItem('schoolAttendance.user') || 'null'); } catch { return null; } };
  const eligible = () => { const u=getUser(); return u?.role === 'SCHOOL_ADMIN' || (u?.role === 'TEACHER' && u.teacherDesignations?.includes('CLASS_ADVISER')); };
  const admin = () => getUser()?.role === 'SCHOOL_ADMIN';
  const api = async (path,options={}) => {
    const token=sessionStorage.getItem('schoolAttendance.accessToken');
    if(!token) throw Error('Sign in to manage guardians.');
    const response=await fetch(path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(data.error||('Request failed ('+response.status+')'));
    return data;
  };
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const btn=(text,fn,cls='outline-button')=>{const n=el('button',text,cls);n.type='button';n.addEventListener('click',fn);return n;};
  const state={student:null};
  let dialog,body,status;
  function ensureDialog(){
    if(dialog)return;
    dialog=el('div',undefined,'guardian-layer');
    dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    const panel=el('section',undefined,'guardian-panel');
    const head=el('div',undefined,'guardian-head');
    head.append(el('h3','Manage guardians'),btn('Close',()=>dialog.hidden=true));
    body=el('div');status=el('p',undefined,'guardian-status');
    panel.append(head,body,status);dialog.append(panel);document.body.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.hidden=true;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.hidden)dialog.hidden=true;});
  }
  function field(form,label,name,kind='input'){
    const wrap=el('label',label,'guardian-field');
    const input=document.createElement(kind);input.name=name;input.required=true;
    if(kind==='input')input.maxLength=name==='mobile'?30:160;
    wrap.append(input);form.append(wrap);return input;
  }
  async function openStudent(id){
    ensureDialog();state.student=id;dialog.hidden=false;body.replaceChildren(el('p','Loading guardian details…'));status.textContent='';
    try{
      const data=await api('/api/guardians/students/'+encodeURIComponent(id));
      if(state.student!==id)return;
      const list=el('div',undefined,'guardian-section');
      list.append(el('h4','Guardian contacts'));
      if(!data.guardians?.length)list.append(el('p','No additional approved guardian records yet. Existing primary contact remains in the student roster.'));
      for(const g of data.guardians||[])list.append(el('p',g.fullName+' · '+g.relationship+(g.isPrimary?' · Primary':'')+(g.active?'':' · Inactive')));
      const history=el('div',undefined,'guardian-section');history.append(el('h4','Request history'));
      if(!data.requests?.length)history.append(el('p','No requests yet.'));
      for(const r of data.requests||[])history.append(el('p',r.requestType.replaceAll('_',' ')+' · '+r.proposedName+' · '+r.status));
      const form=el('form',undefined,'guardian-form');form.append(el('h4','Request a guardian change'));
      const typeWrap=el('label','Request type','guardian-field'),type=document.createElement('select');type.name='requestType';
      for(const [value,label] of [['ADD','Add secondary guardian'],['CHANGE_PRIMARY','Change primary guardian'],['CORRECT','Correct primary contact']]){const option=el('option',label);option.value=value;type.append(option);}
      typeWrap.append(type);form.append(typeWrap);
      field(form,'Guardian full name','fullName');field(form,'Mobile number','mobile');
      const rel=field(form,'Relationship','relationship');rel.placeholder='Mother, Father, Legal guardian…';
      field(form,'Reason for change','reason','textarea');
      const submit=el('button','Submit request','primary-button');submit.type='submit';form.append(submit);
      form.addEventListener('submit',async e=>{
        e.preventDefault();submit.disabled=true;status.textContent='Submitting request…';
        try{const v=Object.fromEntries(new FormData(form));for(const [key,value] of Object.entries(v))v[key]=String(value).trim();if(!v.reason){status.textContent='Please explain why the guardian information needs to change.';return;}await api('/api/guardians/students/'+encodeURIComponent(id)+'/requests',{method:'POST',body:JSON.stringify(v)});await openStudent(id);status.textContent='Request submitted for review. Parent Portal access is unchanged.';}
        catch(err){status.textContent=err.message;}finally{submit.disabled=false;}
      });
      const tabs=el('div',undefined,'guardian-tabs');
      const panes={contacts:list,request:form,history};
      const tabButtons={};
      const switchTab=name=>{
        for(const [key,pane] of Object.entries(panes)){pane.hidden=key!==name;tabButtons[key].classList.toggle('active',key===name);}
      };
      for(const [key,label] of [['contacts','Guardians'],['request','Request change'],['history','History']]){
        tabButtons[key]=btn(label,()=>switchTab(key),'guardian-tab');tabs.append(tabButtons[key]);
      }
      body.replaceChildren(el('p','Student ID: '+id,'guardian-student-id'),tabs,list,form,history);
      switchTab('contacts');
    }catch(err){body.replaceChildren(el('p','Could not load guardian details.'));status.textContent=err.message;}
  }
  async function openQueue(){
    ensureDialog();state.student=null;dialog.hidden=false;body.replaceChildren(el('p','Loading guardian requests…'));status.textContent='';
    try{
      const data=await api('/api/guardians/requests');
      const pending=(data.requests||[]).filter(r=>r.status==='PENDING');
      const list=el('div');list.append(el('h4','Pending guardian approvals'));
      if(!pending.length)list.append(el('p','No pending guardian requests.'));
      for(const r of pending){
        const item=el('section',undefined,'guardian-request');
        item.append(el('strong',r.studentId+' · '+r.requestType.replaceAll('_',' ')),el('p',(r.previousName||'No current primary')+' → '+r.proposedName+' ('+r.relationship+')'),el('p',r.reason));
        const note=field(item,'Review note','note','textarea');
        for(const [decision,label] of [['APPROVED','Approve'],['REJECTED','Reject']]){
          const b=btn(label,async()=>{
            if(!note.value.trim()){status.textContent='A review note is required.';note.focus();return;}
            b.disabled=true;
            try{await api('/api/guardians/requests/'+encodeURIComponent(r.requestId)+'/review',{method:'POST',body:JSON.stringify({decision,note:note.value.trim()})});await openQueue();document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));status.textContent='Request reviewed successfully.';}
            catch(err){status.textContent=err.message;b.disabled=false;}
          },decision==='APPROVED'?'primary-button':'outline-button');item.append(b);
        }
        list.append(item);
      }
      body.replaceChildren(list);
      refreshApprovalCount(true);
    }catch(err){body.replaceChildren(el('p','Could not load approvals.'));status.textContent=err.message;}
  }
  let lastCountRefresh=0;
  async function refreshApprovalCount(force=false){
    const button=$('guardianApprovalsNav'), badge=$('guardianNavBadge');
    if(!button || !admin()) return;
    if(!force && Date.now()-lastCountRefresh<20000) return;
    lastCountRefresh=Date.now();
    try {
      const data=await api('/api/guardians/requests');
      const count=(data.requests||[]).filter(r=>r.status==='PENDING').length;
      button.title=count?count+' guardian requests awaiting review':'Review guardian change requests';
      if(badge){badge.textContent=String(count);badge.hidden=!count;}
    }catch(error){
      button.title='Guardian request count unavailable: '+error.message;
    }
  }
  function enhance(){
    if(!eligible())return;
    const roster=$('studentRows');
    if(roster){
      for(const row of roster.querySelectorAll('tr')){
        if(row.querySelector('[data-guardian-open]'))continue;
        const anchor=row.querySelector('[data-edit-student], [data-student-account]');
        if(!anchor)continue;
        const id=anchor.dataset.editStudent||anchor.dataset.studentAccount;
        if(!id)continue;
        const action=anchor.closest('.student-row-actions')||anchor.parentElement;
        if(!action)continue;
        const button=btn('Manage guardians',()=>openStudent(id));button.dataset.guardianOpen=id;
        action.append(button);
      }
    }
    if(admin()){
      const button=$('guardianApprovalsNav');
      // The unified approval inbox is the only visible School Admin requests entry.
      // Keep the legacy guardian trigger hidden for internal compatibility.
      refreshApprovalCount();
    }
  }
  // A single entry point shared by the sidebar and approval notification bell.
  window.AttendigoGuardian=Object.freeze({
    openApprovals(){ if(admin()) return openQueue(); },
    refreshApprovals(){ if(admin()) return refreshApprovalCount(true); }
  });
  function start(){
    // No observer on the dialog: only the student table can trigger enhancements.
    const roster=$('studentRows');
    if(roster){new MutationObserver(()=>enhance()).observe(roster,{childList:true});}
    enhance();
    $('guardianApprovalsNav')?.addEventListener('click',()=>{if(admin())openQueue();});
    document.addEventListener('attendigo:requests-changed',()=>refreshApprovalCount(true));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshApprovalCount(true);});
    document.addEventListener('click',event=>{if(event.target.closest('[data-view]'))refreshApprovalCount();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();