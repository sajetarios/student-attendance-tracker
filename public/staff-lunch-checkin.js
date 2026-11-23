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
  // iOS Code Scanner and other in-app browsers may restore this document from
  // back-forward cache after staff login. Recheck the server session using the
  // original in-memory challenge; never persist the QR bearer token.
  let completed=false;
  window.addEventListener('pageshow',event=>{
    if(!event.persisted || !valid || completed)return;
    location.replace('/staff-lunch-checkin.html#'+new URLSearchParams({id:challengeId,token}).toString());
  });
  function message(text,kind){
    status.textContent=text;
    status.dataset.kind=kind||'info';
  }
  if(!valid) {
    message('This lunch QR link no longer contains an active scan. Open a fresh QR from the authorized presenter. Your staff login may still be active.','error');
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
  // Only the server can certify a DTR timestamp. Browser geolocation is
  // optional evidence: weak GPS / denied permission becomes Pending Review.
  async function currentPosition(){
    if(!window.attendigoPreciseLocation)return null;
    try{
      return await window.attendigoPreciseLocation.collectPreciseLocation({
        onProgress:quality=>message('Checking GPS near your department: reported accuracy about '+
          quality.accuracyMeters+' m ('+quality.sampleCount+' reading(s))…')
      });
    }catch(error){return null;} // Lack of GPS must be Pending Review, not fabricated attendance.
  }
  let submitting=false;
  confirm.addEventListener('click',async()=>{
    if(submitting||completed)return;
    submitting=true;
    confirm.disabled=true;
    message('Collecting fresh GPS readings, then checking your department location…');
    try{
      const position=await currentPosition();
      const response=await fetch('/api/staff-attendance/lunch/redeem',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({challengeId,token,location:position})
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(body.error||('Verification failed ('+response.status+').'));
      if(body.status==='VERIFIED'){
        message((body.slot==='AM_OUT'?'Lunch Time-Out':'Lunch Return')+
          ' verified. Your official DTR entry was recorded.','success');
      }else{
        message('Scan received, but NOT yet recorded in the official DTR. School Admin review is required. You may also use supervised Gatekeeper scanning.','info');
      }
      completed=true;
      confirm.hidden=true;
    }catch(error){
      if(error instanceof TypeError){
        message('Connection interrupted. No verified attendance confirmed. Reconnect and retry this scan promptly, or use Gatekeeper scanning.','error');
        confirm.disabled=false; // Safe to retry: server rejects duplicate events.
      }else{
        message(error.message+' Ask for a current QR or use supervised Gatekeeper scanning.','error');
        confirm.hidden=true;
      }
    }finally{submitting=false;}
  });
})();
