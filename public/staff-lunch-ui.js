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
    let assigned=false,expiryTimestamp=0,busy=false;
    function setStatus(message,failed=false) {
      status.textContent=message;
      status.classList.toggle('is-error',failed);
    }
    function clearQr(){
      expiryTimestamp=0;
      if(output){output.removeAttribute('src');output.hidden=true;}
      if(expiry)expiry.textContent='';
    }
    function setBusy(value) {
      busy=value;
      slot.disabled=value;
      action.disabled=value || (!admin&&!assigned);
      if(revoked)revoked.disabled=value||!assigned;
      if(teacherSelect)teacherSelect.disabled=value;
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
          if(info.presenterUserId && [...teacherSelect.options].some(x=>x.value===info.presenterUserId))
            teacherSelect.value=info.presenterUserId;
          setStatus(assigned
            ? slotLabel(slot.value)+' presenter: '+info.presenterName
            : 'No teacher assigned for '+slotLabel(slot.value)+'.');
          revoked.disabled=!assigned;
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
      try {
        const teachers=(await request('/api/teachers')).teachers||[];
        const eligible=teachers.filter(t=>t.active===true && t.teacherStatus!=='ON_LEAVE');
        teacherSelect.replaceChildren(new Option('Select an active teacher',''));
        eligible.forEach(t=>teacherSelect.add(new Option(t.displayName+' · '+t.departmentName,t.userId)));
      }catch(error){setStatus('Unable to load teachers: '+error.message,true);action.disabled=true;return;}
      action.addEventListener('click',async()=>{
        if(!teacherSelect.value){setStatus('Select an active teacher first.',true);return;}
        setBusy(true);
        try{
          const result=await request('/api/staff-attendance/lunch/presenter',{
            method:'PUT',body:JSON.stringify({slot:slot.value,presenterUserId:teacherSelect.value})
          });
          assigned=true;
          setStatus(result.presenterName+' assigned to '+slotLabel(slot.value)+'. Older presenter QR codes were revoked.');
        }catch(error){setStatus(error.message,true);}finally{setBusy(false);await refresh();}
      });
      revoked.addEventListener('click',async()=>{
        if(!assigned||!window.confirm('Revoke the '+slotLabel(slot.value)+' presenter and all active QR codes?'))return;
        setBusy(true);
        try{
          await request('/api/staff-attendance/lunch/presenter',{
            method:'DELETE',body:JSON.stringify({slot:slot.value})
          });
          assigned=false;setStatus('Presenter revoked. Existing QR codes are no longer valid.');
        }catch(error){setStatus(error.message,true);}finally{setBusy(false);await refresh();}
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
          expiryTimestamp=new Date(result.expiresAt).getTime();
          setStatus(slotLabel(slot.value)+' QR ready. Staff scan with their own signed-in phone.');
          if(expiry)expiry.textContent='Expires in about 60 seconds; refreshing automatically while this page is open.';
        }catch(error){clearQr();setStatus(error.message,true);}finally{setBusy(false);}
      }
      // Rotation occurs only for the presenter while the teacher is viewing the
      // personal attendance page; old challenges are revoked server-side.
      window.setInterval(()=>{
        const view=$('myGateAttendanceView');
        if(!document.hidden && view&&!view.hidden && assigned && expiryTimestamp &&
           Date.now()>expiryTimestamp-15000 && !busy)issue().catch(()=>{});
      },5000);
    }
    await refresh();
  }
  window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
