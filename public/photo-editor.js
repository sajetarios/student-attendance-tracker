'use strict';
/* Local, dependency-free square photo editor. Source images retain aspect ratio.
   Each saved image is a normalized 512×512 WebP and 128×128 thumbnail,
   while the original image is sent privately for future re-cropping. */
(function(){
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ACCEPT='image/jpeg,image/png,image/webp';
 const allowed=['image/jpeg','image/png','image/webp'];
 const MAX=5*1024*1024;
 function blobBase64(blob){
  return new Promise((resolve,reject)=>{const reader=new FileReader();
   reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
   reader.onerror=()=>reject(new Error('Unable to read selected photo.'));
   reader.readAsDataURL(blob);
  });
 }
 function canvasBlob(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Your browser could not export this photo.')), 'image/webp',.86));
 }
 async function edit(file,{approvalRequired=false,purpose='profile'}={}){
  if(!file)return null;
  const isLogo = purpose === 'school-logo';
  if(!allowed.includes(file.type)||file.size>MAX||!file.size)throw Error('Use a JPG, PNG or WebP photo up to 5 MB.');
  const url=URL.createObjectURL(file);
  const image=new Image();
  try {
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('The image could not be opened.'));image.src=url;});
   if(image.naturalWidth<40||image.naturalHeight<40)throw Error('Choose a photo with at least 40 pixels per side.');
   return await new Promise(resolve=>{
    const dialog=document.createElement('dialog');
    dialog.className='photo-editor-dialog';
    dialog.setAttribute('aria-labelledby','photoEditorTitle');
    dialog.innerHTML=`<header class="photo-editor-heading"><div><p>${isLogo ? 'SCHOOL IDENTITY' : 'PROFILE PHOTO'}</p><h2 id="photoEditorTitle">${isLogo ? 'Adjust your school logo' : 'Adjust your photo'}</h2><span>Drag to reposition. Zoom without stretching the image.</span></div><button type="button" class="photo-editor-close" aria-label="Cancel photo upload">×</button></header>
     <div class="photo-editor-stage"><canvas width="512" height="512" tabindex="0" aria-label="Photo preview. Drag or use arrow keys to reposition."></canvas><div class="photo-editor-round-guide" aria-hidden="true"></div><span class="photo-editor-instruction">Drag to reposition</span></div>
     <div class="photo-editor-controls"><label>Zoom <input type="range" min="1" max="3" step="0.01" value="1" aria-label="Zoom photo"><output>100%</output></label>
     <div class="photo-editor-tools"><button type="button" data-action="rotate">↻ Rotate</button><button type="button" data-action="reset">Reset</button><button type="button" data-action="contain">${isLogo ? 'Crop to fill square' : 'Skip cropping · show full photo'}</button></div></div>
     <p class="photo-editor-note">${isLogo ? 'Your school logo stays proportional in a 512 × 512 square. Zoom or reposition it without stretching.' : 'Photos are saved in a standard square frame (512 × 512 pixels). Full-photo mode adds margins if necessary.'}</p>
     <p class="photo-editor-message" role="status"></p>
     <footer><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save" class="primary-button">Save photo</button></footer>`;
    document.body.appendChild(dialog);
    const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d');
    const slider=dialog.querySelector('input[type=range]'),out=dialog.querySelector('output');
    const message=dialog.querySelector('.photo-editor-message'),save=dialog.querySelector('[data-action=save]');
    if(approvalRequired)save.textContent='Submit for approval';
     else if(isLogo)save.textContent='Use cropped logo';
    let dx=0,dy=0,rotation=0,full=isLogo,done=false,drag=null;
    function draw(){
      ctx.clearRect(0,0,512,512);
      ctx.fillStyle='#e7edf4';ctx.fillRect(0,0,512,512);
      const turned=rotation%180!==0;
      const w=turned?image.naturalHeight:image.naturalWidth;
      const h=turned?image.naturalWidth:image.naturalHeight;
      const base=(full?Math.min:Math.max)(512/w,512/h)*Number(slider.value);
      ctx.save();ctx.beginPath();ctx.rect(0,0,512,512);ctx.clip();
      ctx.translate(256+dx,256+dy);ctx.rotate(rotation*Math.PI/180);ctx.scale(base,base);
      ctx.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);
      ctx.restore();
      out.textContent=Math.round(Number(slider.value)*100)+'%';
      const toggle=dialog.querySelector('[data-action=contain]');
      toggle.setAttribute('aria-pressed',String(full));
      toggle.textContent=full?'Crop to fill square':(isLogo?'Show entire logo':'Skip cropping · show full photo');
    }
    function end(value){
      if(done)return;done=true;
      dialog.close();dialog.remove();resolve(value);
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();end(null)});
    dialog.querySelector('.photo-editor-close').addEventListener('click',()=>end(null));
    dialog.querySelector('[data-action=cancel]').addEventListener('click',()=>end(null));
    slider.addEventListener('input',draw);
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      drag={x:event.clientX,y:event.clientY,dx,dy};canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{
      if(!drag)return;
      const side=canvas.getBoundingClientRect().width||320;
      dx=drag.dx+(event.clientX-drag.x)*512/side;dy=drag.dy+(event.clientY-drag.y)*512/side;
      draw();
    });
    canvas.addEventListener('pointerup',()=>{drag=null});
    canvas.addEventListener('pointercancel',()=>{drag=null});
    canvas.addEventListener('keydown',e=>{
      const delta=e.shiftKey?16:4;
      if(e.key==='ArrowLeft')dx-=delta;else if(e.key==='ArrowRight')dx+=delta;
      else if(e.key==='ArrowUp')dy-=delta;else if(e.key==='ArrowDown')dy+=delta;else return;
      e.preventDefault();draw();
    });
    dialog.querySelector('[data-action=rotate]').addEventListener('click',()=>{rotation=(rotation+90)%360;dx=dy=0;draw()});
    dialog.querySelector('[data-action=reset]').addEventListener('click',()=>{rotation=0;dx=dy=0;full=isLogo;slider.value='1';draw()});
    dialog.querySelector('[data-action=contain]').addEventListener('click',()=>{full=!full;dx=dy=0;slider.value='1';draw()});
    save.addEventListener('click',async()=>{
      save.disabled=true;message.textContent='Preparing photo…';
      try{
       draw();
       const thumb=document.createElement('canvas');thumb.width=128;thumb.height=128;
       thumb.getContext('2d').drawImage(canvas,0,0,128,128);
       const [original,cropped,small]=await Promise.all([
         blobBase64(file),canvasBlob(canvas).then(blobBase64),canvasBlob(thumb).then(blobBase64)
       ]);
       end({original,originalMime:file.type,cropped,thumb:small});
      }catch(e){message.textContent=e.message;save.disabled=false;}
    });
    dialog.showModal();draw();canvas.focus();
   });
  }finally{URL.revokeObjectURL(url)}
 }
 async function post(url,token,payload){
   const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      cache:'no-store',body:JSON.stringify(payload)});
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.error||'Photo upload failed.');
   return data;
 }
 function pick(callback){
   const input=document.createElement('input');input.type='file';input.accept=ACCEPT;input.hidden=true;
   document.body.appendChild(input);
   input.addEventListener('change',async()=>{
     const file=input.files?.[0];input.remove();if(!file)return;
     try{await callback(file)}catch(e){window.alert?.(e.message||'Photo upload failed.')}
   },{once:true});input.click();
   window.setTimeout(()=>input.remove(),120000);
 }
 function selectAndUpload(url,token,onFinish,{approvalRequired=false,onProgress,onError,onDone}={}){
   pick(async file=>{
    const payload=await edit(file,{approvalRequired});if(!payload)return;
    onProgress?.();
    try{
      const result=await post(url,token,payload);
      await onFinish?.(result);
    }catch(error){
      if(onError)onError(error);
      else throw error;
    }finally{onDone?.();}
   });
 }
 async function loadImage(url,token,img){
   try{
    const r=await fetch(url,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    if(!r.ok)return false;
    const temp=URL.createObjectURL(await r.blob());
    img.addEventListener('load',()=>URL.revokeObjectURL(temp),{once:true});
    img.src=temp;img.hidden=false;
    return true;
   }catch{return false;}
 }
 // Supports existing staff account dialog and parent/student cards.
 function mountSelf({token,role,studentId,container,displayName}){
   const target=document.querySelector(container);
   if(!target||target.querySelector('.my-photo-widget'))return;
   const isPlatform=role==='SUPER_ADMIN';
   const isStudent=role==='STUDENT';
   const isParent=role==='PARENT';
   const needsApproval=isStudent||(!isPlatform&&!isParent&&role!=='SCHOOL_ADMIN');
   const readUrl=isPlatform?'/api/platform/profile-photo':'/api/photos/me';
   const uploadUrl=isPlatform?'/api/platform/profile-photo':
     isStudent?'/api/photos/request/student/'+encodeURIComponent(studentId):'/api/photos/self';
   const label=needsApproval?'Request photo approval':'Upload or change photo';
   const wrap=document.createElement('section');
   wrap.className='my-photo-widget';
   wrap.innerHTML=`<div class="my-photo-avatar"><span aria-hidden="true">`+esc(String(displayName||'?').charAt(0).toUpperCase())+`</span><img alt="Your profile photo" hidden></div>
     <div class="my-photo-copy"><strong>Profile picture</strong><p>Move and zoom without stretching. `+
       (needsApproval?'Your existing photo stays visible until the School Admin approves the replacement.':'Your profile picture updates after upload.')+
       `</p><button type="button" class="outline-button">`+label+`</button>
     <small role="status" class="my-photo-status"></small></div>`;
   if(target.matches('dialog')&&target.querySelector('.dialog-header'))target.querySelector('.dialog-header').after(wrap);
   else target.prepend(wrap);
   const img=wrap.querySelector('img');
   const initial=wrap.querySelector('.my-photo-avatar span');
   const status=wrap.querySelector('.my-photo-status');
   const button=wrap.querySelector('button');
   async function refreshPhoto(){
     const loaded=await loadImage(readUrl,token,img);
     if(!loaded)return false;
     initial.hidden=true;
     const top=document.getElementById('userAvatar');
     if(top){
       const avatarImg=document.createElement('img');avatarImg.alt='Profile picture';
       if(await loadImage(readUrl,token,avatarImg))top.replaceChildren(avatarImg);
     }
     return true;
   }
   refreshPhoto();
   button.addEventListener('click',()=>selectAndUpload(uploadUrl,token,async result=>{
     if(result.status==='PENDING'){
       status.textContent='Submitted for School Admin approval. Your current profile photo will remain visible until approved.';
       return;
     }
     if(result.status==='APPROVED'){
       const refreshed=await refreshPhoto();
       status.textContent=refreshed?'Profile picture saved and updated.':'Photo saved, but the picture could not refresh. Please reload the page.';
       return;
     }
     status.textContent='Upload returned an unexpected status. Please refresh and check your photo.';
   },{
     approvalRequired:needsApproval,
     onProgress:()=>{button.disabled=true;status.textContent=needsApproval?'Submitting your photo for approval…':'Saving your profile photo…';},
     onError:error=>{status.textContent=error.message||'Photo upload failed. Please try again.';},
     onDone:()=>{button.disabled=false;}
   }));
   if(needsApproval){
     fetch('/api/photos/my-status',{headers:{Authorization:'Bearer '+token},cache:'no-store'})
       .then(r=>r.ok?r.json():null)
       .then(data=>{if(data?.pending&&!status.textContent)status.textContent='A photo replacement is awaiting School Admin approval.';})
       .catch(()=>{});
   }
 }
 function mountReviews({token,role,designations=[]}){
   const eligible=role==='SCHOOL_ADMIN';
   if(!eligible)return;
   const parent=document.querySelector(role==='SCHOOL_ADMIN'?'#accountAccessPanel':'#studentsView');
   if(!parent||parent.querySelector('.photo-review-panel'))return;
   const section=document.createElement('section');
   section.className='photo-review-panel surface-card section-card';
   section.innerHTML=`<div class="section-toolbar"><div><h3>Photo approval requests</h3>
    <p>Review student photo replacements and staff self-upload requests. Official photos remain unchanged until approved.</p></div>
    <button type="button" class="outline-button photo-review-refresh">Refresh requests</button></div>
    <div class="photo-review-list" role="status" aria-live="polite">Loading requests…</div>`;
   parent.insertBefore(section,parent.firstChild);
   const list=section.querySelector('.photo-review-list');
   async function refresh(){
    list.textContent='Loading requests…';
    try{
     const r=await fetch('/api/photos/requests',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
     const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load requests.');
     list.replaceChildren();
     if(!data.requests.length){list.textContent='No pending photo replacements.';return;}
     for(const item of data.requests){
       const row=document.createElement('div');row.className='photo-review-item';
       const img=document.createElement('img');img.alt='Proposed photo for '+item.subjectName;
       img.className='photo-review-preview';
       row.appendChild(img);
       const copy=document.createElement('div');copy.className='photo-review-details';
       const strong=document.createElement('strong');strong.textContent=item.subjectName;
       const small=document.createElement('small');small.textContent=item.subjectKind+' · Requested '+new Date(item.createdAt).toLocaleDateString('en-PH');
       copy.append(strong,small);
       const actions=document.createElement('div');actions.className='photo-review-actions';
       for(const decision of ['APPROVED','REJECTED']){
        const button=document.createElement('button');button.type='button';button.className=decision==='APPROVED'?'primary-button':'outline-button';
        button.textContent=decision==='APPROVED'?'Approve':'Reject';
        button.addEventListener('click',async()=>{
         actions.querySelectorAll('button').forEach(btn=>btn.disabled=true);
         try{
          await post('/api/photos/requests/'+encodeURIComponent(item.requestId)+'/review',token,{decision});
          row.remove();if(!list.children.length)list.textContent='No pending photo replacements.';
         }catch(e){small.textContent=e.message;actions.querySelectorAll('button').forEach(btn=>btn.disabled=false);}
        });
        actions.appendChild(button);
       }
       row.append(copy,actions);list.appendChild(row);
       loadImage('/api/photos/requests/'+encodeURIComponent(item.requestId)+'/preview',token,img);
     }
    }catch(e){list.textContent=e.message;}
   }
   section.querySelector('.photo-review-refresh').addEventListener('click',refresh);
   refresh();
 }
 function mountParentStudentRequests(token){
  if(document.body.dataset.childPhotoWired)return;
  document.body.dataset.childPhotoWired='1';
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-photo-child]');if(!button)return;
    const id=button.dataset.photoChild;
    selectAndUpload('/api/photos/request/student/'+encodeURIComponent(id),token,result=>{
      const feedback=document.getElementById('feedback');
      if(feedback)feedback.textContent=result.status==='PENDING'?'Photo submitted for school review. The existing official photo stays in place.':'Photo uploaded.';
    },{approvalRequired:true});
  });
 }
 window.ProfilePhotos={edit,post,mountSelf,mountReviews,mountParentStudentRequests,selectAndUpload};
})();
