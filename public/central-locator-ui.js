'use strict';
(()=>{
 const identity=window.attendigoStaffIdentity;if(!identity)return;
 const $=id=>document.getElementById(id);
 const el=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=text;return x;};
 const btn=(text,fn)=>{const b=el('button',text);b.type='button';b.className='outline-button';b.addEventListener('click',fn);return b;};
 const api=async(url,body)=>{const token=sessionStorage.getItem('schoolAttendance.accessToken')||'';const r=await fetch(url,{cache:'no-store',credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.error||'Request unavailable.');}return r;};
 identity.then(user=>{
  if(user?.role==='SCHOOL_ADMIN'){
   const host=$('locatorLibraryRequest');if(!host)return;
   const panel=el('section'),title=el('h4','Verified division templates'),status=el('p'),list=el('select'),active=btn('Use selected template',()=>save(list.value||null)),restore=btn('Use existing DepEd or Mati layout',()=>save(null));
   list.setAttribute('aria-label','Verified division template');status.setAttribute('role','status');
   panel.append(title,el('p','Select a centrally verified form for your division. No field configuration is required.'),list,active,restore,status);
   host.before(panel);panel.hidden=true;
   let busy=false;
   async function load(){if(busy)return;busy=true;try{
    const data=await(await api('/api/school/locator-templates')).json();panel.hidden=false;list.replaceChildren(new Option('Select a verified template',''));
    for(const t of data.templates)list.add(new Option(t.division+' — '+new Date(t.publishedAt).toLocaleString(),t.templateId));
    list.value=data.selected||'';active.disabled=!list.value;
    restore.disabled=!data.selected;
    status.textContent=data.selected&&!list.value?'Your active template no longer matches your division. Select a matching template or restore the existing layout.':data.selected?'A verified division template is active.':data.templates.length?'Choose a form or keep your existing layout.':'No verified division forms are available yet.';
   }catch(e){panel.hidden=true;}finally{busy=false;}}
   list.addEventListener('change',()=>active.disabled=!list.value);
   async function save(templateId){if(busy)return;busy=true;active.disabled=true;restore.disabled=true;try{await api('/api/school/locator-templates/activate',{templateId});}catch(e){status.textContent=e.message;busy=false;active.disabled=!list.value;restore.disabled=false;return;}busy=false;await load();}
   const view=$('schoolBrandingView');if(view){new MutationObserver(()=>{if(!view.hidden)void load();}).observe(view,{attributes:true,attributeFilter:['hidden']});if(!view.hidden)void load();}
  }else if(user?.role==='SUPER_ADMIN'){
   const host=$('platformLocatorRequests');if(!host)return;
   const section=el('details'),heading=el('summary','Configure and publish a verified division template'),select=el('select'),status=el('p'),field=el('select'),sheet=el('div'),image=el('img'),marks=el('div'),sampleLink=el('a'),check=el('input'),label=el('label');
   const fields=[['name','Employee name'],['position','Position'],['station','School / station'],['purpose','Purpose'],['destination','Destination'],['event','Date and time'],['business','Official Business mark (optional)'],['filed','Date filed (optional)'],['region','Region (optional)'],['division','Division (optional)'],['head','School head name (optional)'],['headPosition','School head position (optional)']];
   select.setAttribute('aria-label','Submitted division form');field.setAttribute('aria-label','Field to place');
   for(const [key,name] of fields)field.add(new Option(name,key));
   check.type='checkbox';label.append(check,document.createTextNode(' I inspected the downloaded sample against the official blank form and verified every mapped field.'));
   status.setAttribute('role','status');sheet.style.cssText='position:relative;max-width:750px;width:100%';image.style.cssText='display:block;width:100%;height:auto;cursor:crosshair';marks.style.cssText='position:absolute;inset:0;pointer-events:none';image.alt='Blank division Locator Slip';sheet.append(image,marks);
   let mapping={},first=null,proof=null,url=null,blankUrl=null,busy=false,id=null;
   const invalidate=()=>{proof=null;check.checked=false;publish.disabled=true;sampleLink.hidden=true;if(url){URL.revokeObjectURL(url);url=null;}};
   const draw=()=>{marks.replaceChildren();for(const [key,r] of Object.entries(mapping)){const box=el('span',key);box.style.cssText='position:absolute;box-sizing:border-box;border:2px solid #0876c6;background:#0876c625;color:#085780;font:12px sans-serif;overflow:hidden;left:'+r[0]*100+'%;top:'+r[1]*100+'%;width:'+r[2]*100+'%;height:'+r[3]*100+'%';marks.append(box);}};
   const prefix=()=>'/api/platform/locator-template-requests/'+encodeURIComponent(id);
   const reload=btn('Load submitted forms',async()=>{if(busy)return;try{const d=await(await api('/api/platform/locator-template-requests')).json();select.replaceChildren(new Option('Choose a submitted form',''));for(const r of d.requests)select.add(new Option(r.division+' — '+r.schoolName,r.requestId));status.textContent='Choose a form and open it.';}catch(e){status.textContent=e.message;}});
   const open=btn('Open blank form',async()=>{if(busy||!select.value)return;busy=true;invalidate();id=null;mapping={};first=null;draw();image.removeAttribute('src');try{const chosen=select.value;const b=await(await api('/api/platform/locator-template-requests/'+encodeURIComponent(chosen)+'/blank-preview')).blob();if(blankUrl)URL.revokeObjectURL(blankUrl);blankUrl=URL.createObjectURL(b);image.src=blankUrl;await image.decode();id=chosen;status.textContent='Choose a field, then click its upper-left and lower-right corners.';}catch(e){status.textContent=e.message;}finally{busy=false;}});
   select.addEventListener('change',()=>{id=null;invalidate();image.removeAttribute('src');mapping={};draw();});
   field.addEventListener('change',()=>{first=null;});
   image.addEventListener('click',e=>{if(busy||!id)return;const b=image.getBoundingClientRect();if(!b.width||!b.height)return;const p=[Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))];if(!first){first=p;status.textContent='Click the opposite corner.';return;}const r=[Math.min(first[0],p[0]),Math.min(first[1],p[1]),Math.abs(first[0]-p[0]),Math.abs(first[1]-p[1])];first=null;if(r[2]<.012||r[3]<.009){status.textContent='Choose a larger area.';return;}mapping[field.value]=r;invalidate();draw();status.textContent='Space saved. Choose the next field.';});
   const clear=btn('Clear selected field',()=>{if(busy)return;delete mapping[field.value];first=null;invalidate();draw();});
   const sample=btn('Generate sample PDF',async()=>{if(busy||!id)return;busy=true;invalidate();try{const r=await api(prefix()+'/sample',{mapping});const b=await r.blob();proof=r.headers.get('X-Locator-Sample-Proof');url=URL.createObjectURL(b);sampleLink.href=url;sampleLink.download='Locator-Slip-SAMPLE.pdf';sampleLink.hidden=false;status.textContent='Download and inspect the sample. Publishing does not activate it for any school.';}catch(e){status.textContent=e.message;}finally{busy=false;}});
   const publish=btn('Publish verified template',async()=>{if(busy||!id||!proof||!check.checked)return;busy=true;publish.disabled=true;try{await api(prefix()+'/publish',{mapping,proof,verified:true});invalidate();status.textContent='Template published. Schools in this division can now select it.';}catch(e){status.textContent=e.message;publish.disabled=false;}finally{busy=false;}});
   check.addEventListener('change',()=>publish.disabled=!proof||!check.checked);
   publish.disabled=true;sampleLink.hidden=true;sampleLink.textContent='Download sample PDF';
   section.append(heading,reload,select,open,el('p','Required: employee name, position, school, purpose, destination, date and time. Signatures remain blank.'),field,clear,sheet,sample,sampleLink,label,publish,status);host.append(section);
  }
 }).catch(()=>{});
})();
