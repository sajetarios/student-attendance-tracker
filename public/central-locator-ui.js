'use strict';
(()=>{
 const identity=window.attendigoStaffIdentity;if(!identity)return;
 const $=id=>document.getElementById(id);
 const el=(tag,text)=>{const x=document.createElement(tag);if(text)x.textContent=text;return x;};
 const btn=(text,fn)=>{const b=el('button',text);b.type='button';b.className='outline-button';b.addEventListener('click',fn);return b;};
 const api=async(url,body)=>{const token=sessionStorage.getItem('schoolAttendance.accessToken')||'';const r=await fetch(url,{cache:'no-store',credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok){const j=await r.json().catch(()=>({}));const error=Error(j.error||'Request unavailable.');error.field=j.field;error.optional=j.optional===true;throw error;}return r;};
 identity.then(user=>{
  if(user?.role==='SCHOOL_ADMIN'){
   const host=$('locatorLibraryRequest');if(!host)return;
   const panel=el('section'),title=el('h4','Locator Slip template'),status=el('p'),list=el('select');
   const activeTitle=el('strong'),activeDetail=el('p'),activeDate=el('p'),activeState=el('span'),activeCard=el('div'),cardHeading=el('div');
   const actions=el('div'),changeArea=el('div'),changeActions=el('div'),selectionLabel=el('label','Available verified templates');
   const previewArea=el('section'),previewTitle=el('h5','Blank template preview'),previewImage=el('img'),previewStatus=el('p');
   const restoreArea=el('div'),restoreText=el('p','Restore the built-in layout selected in Official document identity? This does not change already approved requests.');
   let busy=false,data=null,previewUrl=null,previewSeq=0,previewing=false;
   panel.className='locator-library locator-school-card';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   activeState.className='locator-school-state';activeCard.className='locator-school-current';cardHeading.className='locator-school-heading';cardHeading.append(title,activeState);
   activeCard.append(cardHeading,activeTitle,activeDetail,activeDate);
   const closePreview=()=>{previewSeq++;previewing=false;previewArea.hidden=true;previewImage.hidden=true;previewImage.removeAttribute('src');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}};
   const preview=btn('Preview active form',()=>showPreview(data?.selected));
   const change=btn('Change template',()=>{changeArea.hidden=!changeArea.hidden;change.setAttribute('aria-expanded',String(!changeArea.hidden));restoreArea.hidden=true;if(!changeArea.hidden)list.focus();});
   const restore=btn('Restore default layout',()=>{restoreArea.hidden=!restoreArea.hidden;changeArea.hidden=true;change.setAttribute('aria-expanded','false');});
   const active=btn('Use selected template',()=>{if(list.value&&list.value!==data?.selected)void save(list.value);});
   const candidatePreview=btn('Preview selected form',()=>showPreview(list.value));
   const cancel=btn('Cancel',()=>{changeArea.hidden=true;change.setAttribute('aria-expanded','false');closePreview();list.value=data?.selected||'';refreshControls();});
   const restoreConfirm=btn('Restore layout',()=>save(null)),restoreCancel=btn('Cancel',()=>restoreArea.hidden=true);
   const previewClose=btn('Close preview',closePreview),retry=btn('Retry',()=>load());
   active.className=restoreConfirm.className='primary-button';retry.hidden=true;actions.className='locator-school-actions';changeActions.className='locator-school-actions';
   list.id='locator-school-template-select';list.setAttribute('aria-label','Verified division template');selectionLabel.htmlFor=list.id;
   change.setAttribute('aria-expanded','false');changeArea.className='locator-school-change';changeArea.hidden=true;changeActions.append(candidatePreview,active,cancel);changeArea.append(selectionLabel,list,changeActions);
   restoreArea.className='locator-school-change';restoreArea.hidden=true;const restoreActions=el('div');restoreActions.className='locator-school-actions';restoreActions.append(restoreConfirm,restoreCancel);restoreArea.append(restoreText,restoreActions);
   previewArea.className='locator-school-preview';previewArea.hidden=true;previewImage.alt='Blank verified division Locator Slip';previewImage.hidden=true;previewStatus.setAttribute('role','status');previewArea.append(previewTitle,previewStatus,previewImage,previewClose);
   actions.append(preview,change,restore);panel.append(activeCard,actions,changeArea,restoreArea,previewArea,status,retry);
   host.before(panel);panel.hidden=true;
   function refreshControls(){
    const chosen=data?.templates?.find(t=>t.templateId===data.selected);
    const selected=data?.templates?.find(t=>t.templateId===list.value);
    preview.hidden=!chosen;change.hidden=!data?.templates?.some(t=>t.templateId!==data.selected);restore.hidden=!data?.selected;
    actions.hidden=preview.hidden&&change.hidden&&restore.hidden;
    preview.disabled=change.disabled=restore.disabled=restoreConfirm.disabled=busy;list.disabled=busy;
    active.disabled=busy||!selected||selected.templateId===data?.selected;
    candidatePreview.disabled=busy||!selected;
    change.textContent=data?.selected?'Change template':'Choose a verified template';
    if(change.hidden){changeArea.hidden=true;change.setAttribute('aria-expanded','false');}
   }
   function present(){
    const current=data.templates.find(t=>t.templateId===data.selected);
    activeState.textContent=current?'Active':data.selected?'Needs review':'Built-in layout';activeState.dataset.state=current?'active':data.selected?'warning':'default';
    activeTitle.textContent=current?current.division:data.selected?'Selected template unavailable':'Default Locator Slip';
    activeDetail.textContent=current?'Centrally verified division template':data.selected?'The saved template no longer matches your division. Choose a matching form or restore the built-in layout.':'Using the DepEd or Mati layout selected in Official document identity.';
    activeDate.textContent=current?'Published: '+new Date(current.publishedAt).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}):'';activeDate.hidden=!current;
    list.replaceChildren(new Option('Select a verified template',''));for(const t of data.templates)list.add(new Option(t.division+' — '+new Date(t.publishedAt).toLocaleString('en-PH'),t.templateId));
    list.value=data.selected||'';status.textContent=!data.templates.length&&!data.selected?'No verified division forms are available yet. You can request one below.':'';
    refreshControls();
   }
   async function load(){
    if(busy)return;busy=true;panel.hidden=false;retry.hidden=true;refreshControls();
    try{data=await(await api('/api/school/locator-templates')).json();closePreview();changeArea.hidden=true;change.setAttribute('aria-expanded','false');restoreArea.hidden=true;present();}
    catch(e){data=null;closePreview();changeArea.hidden=true;restoreArea.hidden=true;activeState.textContent='Unavailable';activeState.dataset.state='warning';activeTitle.textContent='Template library unavailable';activeDetail.textContent='Your existing template has not been changed.';activeDate.hidden=true;status.textContent=e.message;retry.hidden=false;}
    finally{busy=false;refreshControls();}
   }
   list.addEventListener('change',()=>{closePreview();refreshControls();});
   async function showPreview(templateId){
    if(busy||!data?.templates.some(t=>t.templateId===templateId))return;closePreview();const seq=previewSeq;previewing=true;previewArea.hidden=false;previewStatus.textContent='Loading blank template…';
    try{const blob=await(await api('/api/school/locator-templates/'+encodeURIComponent(templateId)+'/preview')).blob();if(seq!==previewSeq)return;if(!blob.type.startsWith('image/png')||!blob.size)throw Error('The preview is unavailable.');previewUrl=URL.createObjectURL(blob);previewImage.src=previewUrl;await previewImage.decode();if(seq!==previewSeq)return;previewImage.hidden=false;previewStatus.textContent='Blank official layout. Check the printed region and division before activation.';}
    catch(e){if(seq===previewSeq){previewStatus.textContent=e.message;previewImage.hidden=true;}}
    finally{if(seq===previewSeq)previewing=false;}
   }
   async function save(templateId){if(busy)return;busy=true;closePreview();status.textContent='Saving template…';refreshControls();try{await api('/api/school/locator-templates/activate',{templateId});busy=false;await load();if(data)status.textContent=templateId?'Verified template activated.':'Built-in layout restored.';}catch(e){status.textContent=e.message;}finally{busy=false;refreshControls();}}
   const view=$('schoolBrandingView');if(view){new MutationObserver(()=>{if(!view.hidden)void load();else closePreview();}).observe(view,{attributes:true,attributeFilter:['hidden']});if(!view.hidden)void load();}
  }else if(user?.role==='SUPER_ADMIN'){
   const host=$('platformLocatorRequests');if(!host)return;
   const section=el('details'),heading=el('summary','Review and publish a division template'),select=el('select'),status=el('p'),field=el('select'),sheet=el('div'),image=el('img'),marks=el('div'),sampleLink=el('a'),check=el('input'),label=el('label');
   const catalog=window.AttendigoLocatorFields;if(!catalog)return;
   const fields=catalog.fields.map(f=>[f.key,f.label]);
   select.setAttribute('aria-label','Submitted division form');field.setAttribute('aria-label','Field to place');
      const refreshFields=selected=>{field.replaceChildren();for(const [name,items] of catalog.groups){const group=el('optgroup');group.label=name;for(const [key,title] of items){group.append(new Option(title,key));for(let i=2;i<=5;i++){const repeated=key+'__'+i;if(mapping[repeated]||selected===repeated)group.append(new Option(catalog.label(repeated),repeated));}}field.append(group);}if(selected&&catalog.descriptor(selected))field.value=selected;};
   check.type='checkbox';label.append(check,document.createTextNode(' I inspected the downloaded sample against the official blank form and verified every mapped field.'));
   status.setAttribute('role','status');sheet.style.cssText='position:relative;max-width:750px;width:100%';image.style.cssText='display:block;width:100%;height:auto;cursor:crosshair';marks.style.cssText='position:absolute;inset:0;pointer-events:none';image.alt='Blank division Locator Slip';image.draggable=false;image.addEventListener('dragstart',e=>e.preventDefault());image.className='locator-mapping-image';sheet.append(image,marks);
   let mapping={},first=null,drag=null,proof=null,url=null,blankUrl=null,busy=false,id=null,published=false;
   const businessConfirm=el('input'),businessLabel=el('label');businessConfirm.type='checkbox';businessLabel.className='locator-library-confirm';businessLabel.append(businessConfirm,document.createTextNode(' I verified the checkbox positions. Official Business is marked; Official Time remains blank.'));businessLabel.hidden=true;
   const profile=el('input'),profileLabel=el('label'),division=el('input'),divisionLabel=el('label');profile.type='checkbox';division.type='checkbox';profileLabel.className=divisionLabel.className='locator-library-confirm';profileLabel.append(profile,document.createTextNode(' The form has these rows in order: Name, Position, Permanent station, Purpose, Please check, Date and time, Destination.'));divisionLabel.append(division,document.createTextNode(' The printed region and division match the selected request; the blank form is official and contains no personal information.'));
   const invalidate=()=>{published=false;publishStatus.classList.remove('is-error');sampleStatus.textContent='';sampleStatus.classList.remove('is-error');removeOptional.hidden=true;failedField=null;proof=null;check.checked=false;division.checked=false;businessConfirm.checked=false;publish.disabled=true;sampleLink.hidden=true;publishStatus.textContent='';if(url){URL.revokeObjectURL(url);url=null;}};
   const emptyPreview=el('div'),previewHelp=el('p'),publishStatus=el('p'),readiness=el('p');
   emptyPreview.className='locator-preview-empty';emptyPreview.append(el('strong','No form opened yet'),el('p','Select a submitted form above to view its PDF.'));sheet.hidden=true;previewHelp.className='locator-step-help';previewHelp.textContent='Open a blank form to begin.';publishStatus.setAttribute('role','status');readiness.className='locator-step-help';
   const progress=el('p');progress.setAttribute('aria-live','polite');const required=catalog.required;const sampleStatus=el('p');sampleStatus.setAttribute('role','status');sampleStatus.setAttribute('aria-live','polite');let failedField=null;
   const draw=()=>{marks.replaceChildren();const count=6-catalog.missing(mapping).length;progress.textContent=count+' of 6 required fields mapped';progressMeter.value=count;readiness.textContent=!id?'Open a submitted form first.':count<6?'Map the remaining '+(6-count)+' required field(s) before generating.':'All required fields mapped. Generate a sample to review.';for(const [key,r] of Object.entries(mapping)){const box=el('span',catalog.label(key));box.style.cssText='position:absolute;box-sizing:border-box;border:2px solid '+(failedField===key?'#b42318':'#0876c6')+';background:#0876c625;color:#085780;font:12px sans-serif;overflow:hidden;left:'+r[0]*100+'%;top:'+r[1]*100+'%;width:'+r[2]*100+'%;height:'+r[3]*100+'%';marks.append(box);}if(first){const dot=el('span');dot.className='locator-selection-dot';dot.style.left=first[0]*100+'%';dot.style.top=first[1]*100+'%';marks.append(dot);}if(drag?.end){const r=window.AttendigoLocatorSuggest.rectangle(drag.start,drag.end),box=el('span');box.className='locator-selection-rectangle';box.style.left=r[0]*100+'%';box.style.top=r[1]*100+'%';box.style.width=r[2]*100+'%';box.style.height=r[3]*100+'%';marks.append(box);}sample.disabled=busy||!id;businessLabel.hidden=!catalog.has(mapping,'business')&&!catalog.has(mapping,'officialTime');syncLayout();};
   const prefix=()=>'/api/platform/locator-template-requests/'+encodeURIComponent(id);
   const reload=btn('Load submitted forms',async()=>{if(busy)return;reload.disabled=true;try{const d=await(await api('/api/platform/locator-template-requests')).json();select.replaceChildren(new Option('Choose a submitted form',''));for(const r of d.requests)select.add(new Option(r.division+' — '+r.schoolName,r.requestId));status.textContent=d.requests.length?'Select a form to begin.':'No submitted forms available.';}catch(e){status.textContent=e.message;}finally{reload.disabled=false;syncLayout();}});
   const open=btn('Open blank form',async()=>{if(busy||!select.value)return;busy=true;invalidate();id=null;mapping={};first=null;drag=null;manual.open=false;previewHelp.textContent='Loading blank form…';draw();emptyPreview.replaceChildren(el('strong','Loading blank form…'));image.removeAttribute('src');try{const chosen=select.value;select.disabled=true;const b=await(await api('/api/platform/locator-template-requests/'+encodeURIComponent(chosen)+'/blank-preview')).blob();if(blankUrl)URL.revokeObjectURL(blankUrl);blankUrl=URL.createObjectURL(b);image.src=blankUrl;await image.decode();id=chosen;recognitionStatus.textContent='';profile.checked=false;refreshFields('name');previewHelp.textContent='Compare the printed division with the selected request.';status.textContent='Confirm the row pattern or adjust the fields manually.';}catch(e){status.textContent=e.message;previewHelp.textContent='Preview unavailable. Try opening the form again.';emptyPreview.replaceChildren(el('strong','Preview unavailable'),el('p','Try opening the selected form again.'));}finally{busy=false;select.disabled=false;draw();}});
   select.addEventListener('change',()=>{id=null;invalidate();image.removeAttribute('src');mapping={};first=null;drag=null;recognitionStatus.textContent='';refreshFields('name');profile.checked=false;manual.open=false;previewHelp.textContent='Open a blank form to begin.';emptyPreview.replaceChildren(el('strong','No form opened yet'),el('p','Open the selected request to view its PDF.'));status.textContent='Open the selected form.';draw();});
   field.addEventListener('change',()=>{first=null;drag=null;draw();if(catalog.checkbox(field.value))status.textContent='Select only the inside of the '+catalog.label(field.value)+'. Official Time stays blank for OB.';});
   const place=(a,b)=>{const r=window.AttendigoLocatorSuggest.rectangle(a,b);first=null;if(r[2]<(catalog.checkbox(field.value)?.005:.012)||r[3]<(catalog.checkbox(field.value)?.004:.009)){draw();status.textContent='Choose a larger blank area.';return;}if(Object.entries(mapping).some(([k,q])=>k!==field.value&&r[0]<q[0]+q[2]&&r[0]+r[2]>q[0]&&r[1]<q[1]+q[3]&&r[1]+r[3]>q[1])){draw();status.textContent='That area overlaps another field. Choose a separate blank cell.';return;}mapping[field.value]=r;invalidate();draw();status.textContent='Saved '+field.options[field.selectedIndex].text+'.';const next=catalog.missing(mapping).find(k=>k!=='event'||!['travelDate','travelDateLong','travelDateNumeric','departTime','returnTime','timeRange','startDateTime','endDateTime'].includes(catalog.baseKey(field.value)));if(next)field.value=next;};
   const at=e=>window.AttendigoLocatorSuggest.point(image.getBoundingClientRect(),e.clientX,e.clientY);
   image.addEventListener('pointerdown',e=>{if(busy||!id||!manual.open||!e.isPrimary||e.button!==0)return;e.preventDefault();drag={id:e.pointerId,start:at(e),x:e.clientX,y:e.clientY,end:null};image.setPointerCapture(e.pointerId);});
   image.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4||drag.end){drag.end=at(e);draw();}});
   image.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const d=drag;drag=null;const p=at(e);if(d.end||Math.hypot(e.clientX-d.x,e.clientY-d.y)>4){place(d.start,p);return;}if(first){place(first,p);return;}first=p;draw();status.textContent='First corner selected. Tap the opposite corner or drag a rectangle.';});
   image.addEventListener('pointercancel',()=>{drag=null;first=null;draw();});
   image.addEventListener('lostpointercapture',()=>{if(drag){drag=null;draw();}});
   const geometry=btn('Use standard row layout',()=>{if(busy||!id)return;if(!profile.checked){status.textContent='Confirm that the printed row order matches the description first.';return;}try{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const suggested=window.AttendigoLocatorSuggest?.suggest(ctx.getImageData(0,0,canvas.width,canvas.height));canvas.width=canvas.height=1;if(!suggested){status.textContent='No unique matching table was detected. Keep the existing layout or use manual adjustments; do not guess.';return;}mapping={...mapping,...suggested};refreshFields('name');first=null;invalidate();draw();status.textContent='Six suggested fields are ready. Review the blue boxes, optionally place the Official Business mark, then generate a sample PDF.';}catch(e){status.textContent='Could not detect the table. Use manual adjustments or retain the existing form.';}});
   const recognitionStatus=el('p');recognitionStatus.setAttribute('role','status');
   const recognize=btn('Auto-detect from form',async()=>{
    if(busy||!id)return;busy=true;recognize.textContent='Reading form…';recognitionStatus.textContent='Reading printed labels and checking nearby blank areas…';draw();
    try{const data=await(await api(prefix()+'/recognize')).json();let count=0;
     for(const [key,rect] of Object.entries(data.mapping||{})){if(mapping[key]||!catalog.descriptor(key)||Object.values(mapping).some(q=>rect[0]<q[0]+q[2]&&rect[0]+rect[2]>q[0]&&rect[1]<q[1]+q[3]&&rect[1]+rect[3]>q[1]))continue;mapping[key]=rect;count++;}
     if(count){invalidate();refreshFields('name');first=null;recognitionStatus.textContent=count+' field placement(s) suggested from '+(data.source==='pdf-text'?'PDF text':'local OCR')+'. Review every highlight. '+catalog.missing(mapping).length+' required information group(s) remain.';}
     else recognitionStatus.textContent=data.source==='ocr-unavailable'?'This form has no stored text labels and local OCR is unavailable on this server. Re-submit the original text PDF or use the standard layout / manual fields.':'No unambiguous new placements found. Use manual fields for uncertain labels.';
     if(data.matches?.some(m=>m.status==='review'))recognitionStatus.textContent+=' Some labels were recognized but have no reliably empty adjacent cell.';
    }catch(e){recognitionStatus.textContent=e.message;}finally{busy=false;recognize.textContent='Auto-detect from form';draw();}
   });
   const clear=btn('Clear selected field',()=>{if(busy)return;const key=field.value;delete mapping[key];refreshFields(catalog.baseKey(key));first=null;drag=null;invalidate();draw();});
   const repeat=btn('Add another placement',()=>{if(busy||!id)return;const base=catalog.baseKey(field.value);if(!catalog.descriptor(base)||!catalog.has(mapping,base)){status.textContent='Map the first placement before adding another.';return;}const key=[2,3,4,5].map(i=>base+'__'+i).find(k=>!mapping[k]);if(!key){status.textContent='Up to five placements per field are supported.';return;}refreshFields(key);first=null;drag=null;manual.open=true;status.textContent='Select another blank area for '+catalog.label(key)+'.';draw();});
   const generate=async()=>{
    if(busy||!id)return;
    const missing=catalog.missing(mapping);
    if(missing.length){sampleStatus.textContent='Select the missing required fields: '+missing.map(k=>k==='event'?'scheduled date, start and end (combined or separate)':catalog.label(k)).join(', ')+'. You may use Suggest field placements first.';sampleStatus.classList.add('is-error');return;}
    busy=true;select.disabled=true;sample.disabled=true;invalidate();sample.textContent='Generating sample…';sampleStatus.textContent='Preparing your sample PDF…';
    try{const r=await api(prefix()+'/sample',{mapping});const b=await r.blob();if(!b.size||!b.type.includes('application/pdf'))throw Error('The server did not return a PDF. Please retry.');proof=r.headers.get('X-Locator-Sample-Proof');if(!proof)throw Error('The sample could not be verified. Please retry.');url=URL.createObjectURL(b);sampleLink.href=url;sampleLink.download='Locator-Slip-SAMPLE.pdf';sampleLink.hidden=false;syncLayout();sampleStatus.textContent='Sample PDF ready. Download and inspect it before publishing.';sampleLink.focus();}
    catch(e){sampleStatus.classList.add('is-error');sampleStatus.textContent=e.message;if(e.field&&catalog.descriptor(e.field)){refreshFields(e.field);failedField=e.field;if(e.optional){removeOptional.hidden=false;removeOptional.textContent='Remove '+catalog.label(e.field)+' and retry';sampleStatus.textContent+=' This field is optional; leave it unmapped if it is already printed.';}else{manual.open=true;sampleStatus.textContent+=' Adjust the highlighted required field and try again.';}}}
    finally{busy=false;select.disabled=false;sample.disabled=!id;sample.textContent='Generate sample PDF';draw();}
   };
   const sample=btn('Generate sample PDF',generate);
   const removeOptional=btn('Remove optional field and retry',()=>{if(busy||!failedField||!catalog.canRemove(mapping,failedField))return;delete mapping[failedField];first=null;drag=null;invalidate();draw();void generate();});removeOptional.hidden=true;
   const publish=btn('Publish verified template',async()=>{if(busy||!id||!proof||!check.checked||!division.checked||((catalog.has(mapping,'business')||catalog.has(mapping,'officialTime'))&&!businessConfirm.checked))return;busy=true;select.disabled=true;publish.disabled=true;syncLayout();publishStatus.textContent='Publishing template…';try{await api(prefix()+'/publish',{mapping,proof,verified:true,divisionConfirmed:true,businessConfirmed:businessConfirm.checked});invalidate();publishStatus.textContent='Template published. Schools in this division can now select it.';sampleStatus.textContent='Template published successfully.';published=true;}catch(e){publishStatus.textContent=e.message;publishStatus.classList.add('is-error');}finally{busy=false;select.disabled=false;draw();verify();}});
   const verify=()=>publish.disabled=busy||!proof||!check.checked||!division.checked||!!((catalog.has(mapping,'business')||catalog.has(mapping,'officialTime'))&&!businessConfirm.checked);businessConfirm.addEventListener('change',verify);check.addEventListener('change',verify);division.addEventListener('change',verify);
   publish.disabled=true;sample.disabled=true;sampleLink.hidden=true;sampleLink.textContent='Download sample PDF';sampleLink.className='outline-button';
   section.className='locator-library locator-review-workspace';section.open=true;
   const controls=el('div');controls.className='locator-review-toolbar';const selectGroup=el('div'),selectLabel=el('label','Submitted form');select.id='locator-review-request';selectLabel.htmlFor=select.id;selectGroup.className='locator-review-select';selectGroup.append(selectLabel,select);controls.append(reload,selectGroup,open);
   const manual=el('details'),manualActions=el('div');manualActions.className='locator-review-manual-actions';manualActions.append(field,repeat,clear);refreshFields('name');manual.append(el('summary','Adjust field placement manually'),el('p','Choose a category and field. Drag or tap two corners; add another placement to repeat the same value. Scheduled times are not actual travel times.'),manualActions);manual.addEventListener('toggle',()=>{first=null;drag=null;image.classList.toggle('is-selecting',manual.open);draw();});
   const makeStep=(number,title,...children)=>{const card=el('section'),head=el('div'),n=el('span',String(number)),h=el('h4',title);card.className='locator-review-step';head.className='locator-step-heading';n.className='locator-step-number';head.append(n,h);card.append(head,...children);return card;};
   const progressMeter=el('progress');progressMeter.max=6;progressMeter.value=0;progressMeter.setAttribute('aria-label','Required fields mapped');
   const fallback=el('details');fallback.append(el('summary','Standard row layout fallback'),profileLabel,geometry);const pattern=makeStep(1,'Recognize printed fields',el('p','Read actual PDF labels and suggest nearby empty cells. Uncertain fields remain unmapped.'),recognize,recognitionStatus,fallback);
   const mappingCard=makeStep(2,'Review field placement',progress,progressMeter,manual,status);
   const sampleCard=makeStep(3,'Generate and review sample',readiness,sample,sampleStatus,removeOptional,sampleLink);
   const verification=makeStep(4,'Verify and publish',el('p','Check the sample and division. Actual travel times and certification signatures must remain blank.'),label,divisionLabel,businessLabel,publish,publishStatus);
   label.className='locator-library-confirm';open.className=recognize.className=sample.className=publish.className='primary-button';
   const preview=el('section'),previewTitle=el('h4','Blank Locator Slip preview'),previewStage=el('div');preview.className='locator-review-preview';previewStage.className='locator-preview-stage';previewStage.append(emptyPreview,sheet);preview.append(previewTitle,previewHelp,previewStage);
   const workspace=el('div');workspace.className='locator-review-grid';pattern.classList.add('locator-pattern-step');mappingCard.classList.add('locator-mapping-step');sampleCard.classList.add('locator-sample-step');verification.classList.add('locator-publish-step');workspace.append(pattern,preview,mappingCard,sampleCard,verification);
   const reminder=el('p','Review reminder: suggested placements are not official certification. Verify the printed division and sample before publishing.');reminder.className='locator-review-reminder';
   const topStatus=el('p');topStatus.className='locator-step-help';topStatus.textContent='Choose a submitted form, then open its blank PDF.';
   section.append(heading,controls,topStatus,reminder,workspace);host.append(section);
   function syncLayout(){sheet.hidden=!id;emptyPreview.hidden=!!id;open.disabled=busy||!select.value;recognize.disabled=geometry.disabled=busy||!id;field.disabled=clear.disabled=repeat.disabled=busy||!id;profile.disabled=busy||!id;reload.disabled=busy;select.disabled=busy;pattern.hidden=!id;mappingCard.hidden=!id;sampleCard.hidden=!id;verification.hidden=!proof&&!published;label.hidden=divisionLabel.hidden=publish.hidden=published;if(published)businessLabel.hidden=true;topStatus.textContent=id?'Form opened. Review the preview and continue through the steps.':status.textContent||'Choose a submitted form, then open its blank PDF.';}
   syncLayout();
   const tab=host.closest('[data-platform-tab]');if(tab){new MutationObserver(()=>{if(!tab.hidden&&!select.options.length)reload.click();}).observe(tab,{attributes:true,attributeFilter:['hidden']});if(!tab.hidden)reload.click();}
  }
 }).catch(()=>{});
})();
