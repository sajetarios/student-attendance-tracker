'use strict';
// Staff lunch QR presenter: privileged assignments and teacher-only self-service.
// All requests use the existing HttpOnly staff session; no tokens enter localStorage.
(() => {
  const $ = id => document.getElementById(id);
  const dateNow = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const slotLabel = slot => slot === 'AM_OUT' ? 'AM Out' : 'PM In';
  async function request(path, options = {}) {
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store',
      ...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data = await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error || ('Request failed ('+response.status+')'));
    return data;
  }
  async function init(user) {
    if(!['SCHOOL_ADMIN','TEACHER'].includes(user?.role))return;
    const admin=user.role==='SCHOOL_ADMIN';
    const host=$(admin?'staffLunchAdminCard':'staffLunchPresenterCard');
    if(!host)return;
    host.hidden=false;
    const status=$(admin?'staffLunchAdminStatus':'staffLunchPresenterStatus');
    const slot=$(admin?'staffLunchAdminSlot':'staffLunchPresenterSlot');
    const day=$(admin?'staffLunchAdminDay':'staffLunchPresenterDay');
    const action=$(admin?'staffLunchAssign':'staffLunchIssueQr');
    const revoked=admin?$('staffLunchRevoke'):null;
    const output=admin?null:$('staffLunchQrImage');
    const expiry=admin?null:$('staffLunchQrExpiry');
    const teacherSelect=admin?$('staffLunchTeacher'):null;
    const departmentSelect=admin?$('staffLunchDepartment'):null;
    const activeList=admin?$('staffLunchAssignedList'):null;
    let eligibleTeachers=[];
    let assigned=false,expiryMonotonicDeadline=0,busy=false;
    function setStatus(message,failed=false) {
      status.textContent=message;
      status.classList.toggle('is-error',failed);
    }
    function clearQr(){
      expiryMonotonicDeadline=0;
      if(output){output.removeAttribute('src');output.hidden=true;}
      if(expiry)expiry.textContent='';
    }
    function setBusy(value) {
      busy=value;
      slot.disabled=value;
      action.disabled=value || (!admin&&!assigned);
      if(revoked)revoked.disabled=value||!assigned;
      if(teacherSelect)teacherSelect.disabled=value;
      if(departmentSelect)departmentSelect.disabled=value;
      if(activeList)activeList.querySelectorAll('button').forEach(button=>{button.disabled=value;});
    }
    async function refresh() {
      if(busy)return;
      clearQr();
      if(day)day.textContent=dateNow();
      try {
        const info=await request('/api/staff-attendance/lunch/presenter?'+
          new URLSearchParams({slot:slot.value}).toString());
        assigned=!!info.assigned;
        if(admin) {
          const presenters=Array.isArray(info.presenters)?info.presenters:[];
          const filter=departmentSelect.value;
          const shown=presenters.filter(p=>!filter||p.departmentId===filter);
          activeList.replaceChildren();
          if(!shown.length){activeList.textContent='No active presenters for this selection.';}
          for(const presenter of shown){
            const row=document.createElement('div');
            row.className='staff-lunch-presenter-row';
            const caption=document.createElement('span');
            const strong=document.createElement('strong');
            strong.textContent=presenter.presenterName;
            const small=document.createElement('small');
            small.textContent=presenter.departmentName||'No department';
            caption.append(strong,small);
            const remove=document.createElement('button');
            remove.type='button';remove.className='outline-button';
            remove.textContent='Revoke';
            remove.setAttribute('aria-label','Revoke lunch presenter '+presenter.presenterName);
            remove.addEventListener('click',async()=>{
              if(!window.confirm('Revoke lunch QR access for '+presenter.presenterName+'? Only this teacher’s QR will be invalidated.'))return;
              setBusy(true);
              try{
                await request('/api/staff-attendance/lunch/presenter',{
                  method:'DELETE',body:JSON.stringify({slot:slot.value,presenterUserId:presenter.presenterUserId})
                });
                setStatus(presenter.presenterName+' revoked. Other presenters remain active.');
              }catch(error){setStatus(error.message,true);}
              finally{setBusy(false);await refresh();}
            });
            row.append(caption,remove);activeList.append(row);
          }
          setStatus(presenters.length+' active presenter(s) for '+slotLabel(slot.value)+'. Select additional teachers to authorize.');
          revoked.disabled=true;
        }else{
          assigned=!!info.isCurrentPresenter;
          setStatus(assigned
            ? 'You are assigned to present the '+slotLabel(slot.value)+' QR today.'
            : info.assigned
              ? slotLabel(slot.value)+' QR is assigned to another teacher.'
              : 'No presenter assigned. Ask your School Administrator.');
          action.disabled=!assigned;
        }
      }catch(error){assigned=false;action.disabled=true;if(revoked)revoked.disabled=true;setStatus(error.message,true);}
    }
    slot.addEventListener('change',()=>{refresh().catch(()=>{});});
    if(admin) {
      try{
        const teachers=(await request('/api/teachers')).teachers||[];
        eligibleTeachers=teachers.filter(t=>t.active===true&&t.teacherStatus!=='ON_LEAVE');
        const departments=new Map();
        eligibleTeachers.forEach(t=>{if(t.departmentId)departments.set(t.departmentId,t.departmentName||'Department');});
        departmentSelect.replaceChildren(new Option('All departments',''));
        [...departments.entries()].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>departmentSelect.add(new Option(name,id)));
        function updateTeacherOptions(){
          const filter=departmentSelect.value;
          teacherSelect.replaceChildren();
          eligibleTeachers.filter(t=>!filter||t.departmentId===filter).forEach(t=>{
            teacherSelect.add(new Option(t.displayName+' · '+(t.departmentName||'No department'),t.userId));
          });
        }
        departmentSelect.addEventListener('change',()=>{updateTeacherOptions();refresh().catch(()=>{});});
        updateTeacherOptions();
      }catch(error){setStatus('Unable to load teachers: '+error.message,true);action.disabled=true;return;}
      action.addEventListener('click',async()=>{
        const ids=[...teacherSelect.selectedOptions].map(option=>option.value);
        if(!ids.length){setStatus('Select at least one teacher. Use Ctrl/Command or Shift for multiple.',true);return;}
        setBusy(true);
        try{
          let added=0;
          for(const id of ids){
            const result=await request('/api/staff-attendance/lunch/presenter',{
              method:'PUT',body:JSON.stringify({slot:slot.value,presenterUserId:id})
            });
            if(!result.unchanged)added++;
          }
          setStatus(added+' new presenter(s) authorized. Existing presenter QR codes remain active.');
          [...teacherSelect.options].forEach(o=>{o.selected=false;});
        }catch(error){setStatus('Some changes may have been saved. '+error.message,true);}
        finally{setBusy(false);await refresh();}
      });
    }else{
      action.addEventListener('click',()=>issue().catch(()=>{}));
      async function issue(){
        if(busy||!assigned)return;
        setBusy(true);clearQr();setStatus('Generating a secure, one-minute QR…');
        try{
          const result=await request('/api/staff-attendance/lunch/challenges',{
            method:'POST',body:JSON.stringify({slot:slot.value})
          });
          if(typeof result.qrImage!=='string'||!result.qrImage.startsWith('data:image/png;base64,'))
            throw Error('QR image unavailable. Please retry.');
          output.src=result.qrImage;
          output.hidden=false;
          if(!Number.isFinite(Number(result.remainingMs)))
            throw Error('Secure lunch QR lifetime unavailable.');
          // Monotonic time does not shift when someone changes the device wall clock.
          expiryMonotonicDeadline=performance.now()+Math.max(0,Math.min(60000,Number(result.remainingMs)));
          setStatus(slotLabel(slot.value)+' QR ready. Staff scan with their own signed-in phone.');
          if(expiry)expiry.textContent='Expires in about 60 seconds; refreshing automatically while this page is open.';
        }catch(error){clearQr();setStatus(error.message,true);}finally{setBusy(false);}
      }
      // Rotation occurs only for the presenter while the teacher is viewing the
      // personal attendance page; old challenges are revoked server-side.
      window.setInterval(()=>{
        const view=$('teacherLunchQrView');
        if(!document.hidden && view&&!view.hidden && assigned && expiryMonotonicDeadline &&
           performance.now()>expiryMonotonicDeadline-15000 && !busy)issue().catch(()=>{});
      },5000);
    }
    await refresh();
  }
  window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
