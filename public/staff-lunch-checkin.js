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
  // Transfer the short-lived challenge only through a URL fragment on the
  // same origin. It is never added to the login query or sent to server logs.
  const loginFragment=new URLSearchParams({lunchId:challengeId,lunchToken:token}).toString();
  $('lunchLogin').href='/portal-login.html#'+loginFragment;
  let me;
  try{
    const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){const err=Error('unauthenticated');err.code=401;throw err;}
    if(!response.ok){const err=Error('verification unavailable');err.code=response.status;throw err;}
    const body=await response.json();
    me=body.user;
    if(!me||!['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(me.role)){
      const err=Error('not-staff');err.code=403;throw err;
    }
  }catch(error) {
    if(error.code===401) {
      message('Your session is not active in this browser. Sign in to continue this scan; no second scan is needed if the QR is still valid.','error');
      $('lunchLogin').hidden=false;
    } else if(error.code===403) {
      message('This account cannot confirm staff lunch attendance. Switch to an authorized staff account.','error');
      $('lunchLogin').hidden=false;
    } else {
      message('Unable to verify your session right now. Check your connection and try again; no new scan is required.','error');
      const retry=$('lunchRetry');
      retry.hidden=false;
      retry.addEventListener('click',()=>location.replace('/staff-lunch-checkin.html#'+new URLSearchParams({id:challengeId,token}).toString()),{once:true});
    }
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
