'use strict';
// School Admin-only invitation controls. Principals themselves never receive
// account-creation privileges.
(() => {
 const card=document.getElementById('principalAdminAccountCard');
 const form=document.getElementById('principalCreateForm');
 const status=document.getElementById('principalCreateStatus');
 if(!card||!form||!status)return;
 window.attendigoStaffIdentity?.then(user=>{
  if(user?.role!=='SCHOOL_ADMIN')return;
  card.hidden=false;
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   const button=form.querySelector('button[type="submit"]');
   const values=new FormData(form);
   const username=String(values.get('username')||'').trim(),
    displayName=String(values.get('displayName')||'').trim(),
    password=String(values.get('password')||'');
   if(password.length<12){
    status.textContent='Use a temporary password of at least 12 characters.';return;
   }
   button.disabled=true;status.textContent='Creating Principal access…';
   try{
    const response=await fetch('/api/principal/accounts',{method:'POST',credentials:'same-origin',
     cache:'no-store',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({username,displayName,password})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.error||'Unable to create account.');
    form.reset();status.textContent='Principal account created for '+body.account.displayName+
     ' ('+body.account.username+'). Share credentials securely. First login requires a password change.';
   }catch(error){status.textContent=error.message;}
   finally{button.disabled=false;}
  });
 }).catch(()=>{});
})();
