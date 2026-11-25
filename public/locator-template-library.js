'use strict';
(()=>{const $=id=>document.getElementById(id);
const identity=window.attendigoStaffIdentity;if(!identity)return;
const request=async(url,method='GET',body)=>{const token=sessionStorage.getItem('schoolAttendance.accessToken')||'';const r=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const j=await r.json().catch(()=>({}));const e=Error(j.error||'Request unavailable.');e.status=r.status;throw e;}return r;};
const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='outline-button';b.textContent=label;b.addEventListener('click',fn);return b;};
identity.then(user=>{
 if(user?.role==='SCHOOL_ADMIN'){
  const panel=$('locatorLibraryRequest'),form=$('locatorLibraryForm'),status=$('locatorLibraryStatus'),file=$('locatorLibraryFile'),confirm=$('locatorLibraryBlank');
  if(!panel||!form)return;
  let busy=false,allowed=false;
  const show=data=>{form.hidden=data?.status==='PENDING';status.textContent=data?.status==='PENDING'?'Submitted — awaiting central review. Your existing form is unchanged.':data?.status==='REVIEWED'?'Your submission has been reviewed. No new template is active yet.':'';};
  async function load(){if(busy)return;try{const r=await request('/api/school/locator-template-request');allowed=true;panel.hidden=false;show((await r.json()).request);}catch(e){if(e.status===403){panel.hidden=true;allowed=false;}else{panel.hidden=false;status.textContent=e.message;}}}
  const view=$('schoolBrandingView');if(view){new MutationObserver(()=>{if(!view.hidden)void load();}).observe(view,{attributes:true,attributeFilter:['hidden']});if(!view.hidden)void load();}
  panel.addEventListener('toggle',()=>{if(panel.open)void load();});
  form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!allowed)return;const f=file.files?.[0];if(!f||f.size>2*1024*1024||!f.name.toLowerCase().endsWith('.pdf')){status.textContent='Choose a blank PDF up to 2 MB.';return;}
   if(!confirm.checked){status.textContent='Confirm the PDF is blank.';return;}
   busy=true;const submit=form.querySelector('button[type=submit]');submit.disabled=true;status.textContent='Submitting blank form…';
   try{const pdf=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Could not read the PDF.'));r.readAsDataURL(f);});const r=await request('/api/school/locator-template-request','POST',{pdf,blankConfirmed:true});form.reset();show((await r.json()).request);}catch(e){status.textContent=e.message;}finally{busy=false;submit.disabled=false;}
  });
 }else if(user?.role==='SUPER_ADMIN'){
  const panel=$('platformLocatorRequests'),list=$('platformLocatorList'),status=$('platformLocatorStatus');if(!panel||!list)return;panel.hidden=false;let busy=false;
  async function load(){if(busy)return;busy=true;status.textContent='Loading requests…';try{const data=await (await request('/api/platform/locator-template-requests')).json();list.replaceChildren();status.textContent=data.requests.length?'':'No template requests yet.';
   for(const row of data.requests){const card=document.createElement('article'),title=document.createElement('strong'),detail=document.createElement('p'),actions=document.createElement('div');title.textContent=row.division+' — '+row.region;detail.textContent=row.schoolName+' · '+(row.status==='PENDING'?'Awaiting review':'Reviewed (not activated)');actions.className='doc-brand-actions';const base='/api/platform/locator-template-requests/'+encodeURIComponent(row.requestId);
    actions.append(button('Download blank PDF',async()=>{try{const blob=await(await request(base+'/pdf')).blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Blank-Locator-Slip.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){status.textContent=e.message;}}));
    if(row.status==='PENDING'){const review=button('Mark reviewed without publishing',async()=>{review.disabled=true;try{await request(base+'/review','POST',{});await load();}catch(e){status.textContent=e.message;}finally{review.disabled=false;}});actions.append(review);}
    card.append(title,detail,actions);list.append(card);
   }
  }catch(e){status.textContent=e.message;}finally{busy=false;}}
  $('platformLocatorRefresh').addEventListener('click',load);const tab=panel.closest('[data-platform-tab]');if(tab)new MutationObserver(()=>{if(!tab.hidden)void load();}).observe(tab,{attributes:true,attributeFilter:['hidden']});if(!tab?.hidden)void load();
 }
}).catch(()=>{});
})();
