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
    let assigned=false,expiryMonotonicDeadline=0,rotationMonotonicDeadline=0,busy=false;
    function setStatus(message,failed=false) {
      status.textContent=message;
      status.classList.toggle('is-error',failed);
    }
    function clearQr(){
      expiryMonotonicDeadline=0;rotationMonotonicDeadline=0;
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
        const setPoint=$('staffLunchSetPoint'),pointStatus=$('staffLunchPointStatus');
        const pendingList=$('staffLunchPendingList'),pendingRefresh=$('staffLunchPendingRefresh');
        const pointMessage=text=>{if(pointStatus)pointStatus.textContent=text;};
        async function showPoint(){
          const departmentId=departmentSelect.value;
          if(setPoint)setPoint.disabled=!departmentId;
          if(!departmentId){pointMessage('Choose a department to set its scanning location.');return;}
          try{
            const point=await request('/api/staff-attendance/lunch/location?'+
              new URLSearchParams({departmentId}).toString());
            pointMessage(point.configured
              ? 'Department location configured · '+point.radiusMeters+' m radius. Set again only if the location changes.'
              : 'Location not configured. Scans here will require School Admin review until you set it.');
          }catch(error){pointMessage(error.message);}
        }
        departmentSelect.addEventListener('change',()=>{updateTeacherOptions();refresh().catch(()=>{});showPoint().catch(()=>{});});
        if(setPoint)setPoint.addEventListener('click',async()=>{
          const departmentId=departmentSelect.value;
          if(!departmentId)return;
          if(!navigator.geolocation){pointMessage('Location services are unavailable on this device. Use a location-enabled phone while in the department.');return;}
          setPoint.disabled=true;pointMessage('Checking your position. Please be physically inside the selected department.');
          try{
            const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{
              enableHighAccuracy:true,timeout:12000,maximumAge:0
            }));
            const accuracyMeters=position.coords.accuracy;
            if(accuracyMeters>100)throw Error('Location accuracy is too low. Move closer to a window or try again on-site.');
            await request('/api/staff-attendance/lunch/location',{
              method:'PUT',body:JSON.stringify({departmentId,latitude:position.coords.latitude,
                longitude:position.coords.longitude,accuracyMeters,radiusMeters:120})
            });
            pointMessage('Department location saved. Teachers can scan here without traveling to the central kiosk.');
          }catch(error){pointMessage('Location not saved: '+error.message);}
          finally{setPoint.disabled=false;}
        });
        async function showPending(){
          if(!pendingList)return;
          pendingList.textContent='Loading scans that need checking…';
          try{
            const result=await request('/api/staff-attendance/lunch/pending');
            pendingList.replaceChildren();
            if(!result.items?.length){pendingList.textContent='No pending lunch scans in the past 7 days.';return;}
            for(const item of result.items){
              const row=document.createElement('div');row.className='staff-lunch-presenter-row';
              const label=document.createElement('span');
              const name=document.createElement('strong');name.textContent=item.teacherName+' · '+slotLabel(item.slot);
              const detail=document.createElement('small');detail.textContent=item.schoolDate+' · '+(item.notes||'Review required');
              label.append(name,detail);
              const controls=document.createElement('span');controls.className='staff-lunch-review-actions';
              for(const decision of ['VERIFY','REJECT']){
                const button=document.createElement('button');button.type='button';button.className='outline-button';
                button.textContent=decision==='VERIFY'?'Verify':'Reject';
                button.addEventListener('click',async()=>{
                  const note=window.prompt('Reason for '+decision.toLowerCase()+'ing '+item.teacherName+
                    ' on '+item.schoolDate+' (at least 10 characters). Independent evidence is required to verify:');
                  if(note===null)return;
                  if(note.trim().length<10){window.alert('Provide a meaningful reason of at least 10 characters.');return;}
                  button.disabled=true;
                  try{
                    await request('/api/staff-attendance/lunch/review',{
                      method:'POST',body:JSON.stringify({eventId:item.eventId,decision,note:note.trim()})
                    });
                    await showPending();
                  }catch(error){window.alert(error.message);button.disabled=false;}
                });
                controls.append(button);
              }
              row.append(label,controls);pendingList.append(row);
            }
          }catch(error){pendingList.textContent='Unable to load pending scans: '+error.message;}
        }
        if(pendingRefresh)pendingRefresh.addEventListener('click',()=>{showPending().catch(()=>{});});
        void showPoint();
        void showPending();
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
        setBusy(true);clearQr();setStatus('Generating a secure, rotating department QR…');
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
          rotationMonotonicDeadline=performance.now()+30000;
          setStatus(slotLabel(slot.value)+' QR ready. Staff scan with their own signed-in phone.');
          if(expiry)expiry.textContent='Changes every 30 seconds. Previous QR remains valid briefly for slow connections.';
        }catch(error){clearQr();setStatus(error.message,true);}finally{setBusy(false);}
      }
      // Rotations happen only in the visible presenter view. The backend
      // overlaps at most a short 60-second validity window for slow networks.
      window.setInterval(()=>{
        const view=$('teacherLunchQrView');
        if(!document.hidden && view&&!view.hidden && assigned && expiryMonotonicDeadline &&
           performance.now()>=rotationMonotonicDeadline && !busy)issue().catch(()=>{});
      },5000);
    }
    await refresh();
  }
  window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
