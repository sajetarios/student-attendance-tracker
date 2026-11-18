'use strict';
(async () => {
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.hash.slice(1));
  const challengeId=String(params.get('id')||''),token=String(params.get('token')||'');
  // Remove the ephemeral bearer token from browser address and history before
  // any login/session call. Never write it to storage, logs, or analytics.
  history.replaceState(null,'',location.pathname);
  const valid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(challengeId) &&
              /^[a-zA-Z0-9_-]{43}$/.test(token);
  const status=$('lunchStatus'),confirm=$('lunchConfirm');
  function message(text,kind){
    status.textContent=text;
    status.dataset.kind=kind||'info';
  }
  if(!valid) {
    message('No valid lunch QR found. Scan the current QR from the authorized presenter.','error');
    return;
  }
  let me;
  try{
    const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('unauthenticated');
    const body=await response.json();
    me=body.user;
    if(!me||!['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(me.role))
      throw Error('not-staff');
  }catch {
    message('A valid school staff sign-in is required. Sign in, then rescan this QR.','error');
    $('lunchLogin').hidden=false;
    return;
  }
  $('lunchName').textContent='Signed in: '+(me.displayName||me.username||'School staff');
  $('lunchName').hidden=false;
  confirm.hidden=false;
  confirm.disabled=false;
  message('Ready to record your verified lunch DTR. Confirm only for yourself.');
  confirm.addEventListener('click',async()=>{
    confirm.disabled=true;
    message('Checking the QR and recording attendance…');
    try{
      const response=await fetch('/api/staff-attendance/lunch/redeem',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({challengeId,token})
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(body.error||('Verification failed ('+response.status+').'));
      message((body.slot==='AM_OUT'?'AM Out':'PM In')+
        ' successfully verified. Your official DTR was recorded.','success');
      confirm.hidden=true;
    }catch(error){
      message(error.message+' Request a fresh QR from the presenter or use the Gatekeeper fallback.','error');
      confirm.hidden=true; // Never reuse a failed/possibly expired QR.
    }
  },{once:true});
})();
