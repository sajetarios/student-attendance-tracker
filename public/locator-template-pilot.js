'use strict';
(()=>{
 const host=document.getElementById('locatorTemplatePilot');
 if(!host)return;
 const $=id=>document.getElementById(id);
 const fields=[
  ['name','employee’s name',true],['position','employee’s position / designation',true],['station','permanent station / school',true],
  ['purpose','purpose of travel',true],['destination','destination',true],['event','date and time of travel',true],
  ['business','Official Business checkbox',false],['filed','date of filing',false],['region','region',false],
  ['division','division',false],['head','school head’s printed name',false],['headPosition','school head’s designation',false]
 ];
 const panel=$('locatorPilotPanel'),status=$('locatorPilotStatus'),image=$('locatorPilotPage'),sheet=$('locatorPilotSheet'),marks=$('locatorPilotMarks');
 let pdf=null,mapping={},index=0,first=null,busy=false,revision=0,sampleUrl=null;
 const say=(s,error=false)=>{status.textContent=s;status.classList.toggle('is-error',error);};
 const show=(step)=>{for(let n=1;n<=3;n++)$('locatorPilotStep'+n).hidden=n!==step;};
 function revoke(){if(sampleUrl){URL.revokeObjectURL(sampleUrl);sampleUrl=null;}};
 function clearDownload(){const previous=$('locatorPilotSaveFile');if(previous.dataset.objectUrl)URL.revokeObjectURL(previous.dataset.objectUrl);delete previous.dataset.objectUrl;previous.replaceChildren();}
 function reset(){
  clearDownload();
  revision++;pdf=null;mapping={};index=0;first=null;revoke();image.removeAttribute('src');$('locatorPilotSample').removeAttribute('src');
  $('locatorPilotFile').value='';$('locatorPilotFile').disabled=false;$('locatorPilotVerified').checked=false;$('locatorPilotOutcome').textContent='';
  $('locatorPilotDownload').disabled=true;marks.replaceChildren();show(1);say('');
 }
 async function request(mode){
  const token=sessionStorage.getItem('schoolAttendance.accessToken')||'';
  const response=await fetch('/api/school/locator-template-pilot',{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
   body:JSON.stringify({pdf,mode,mapping})});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Could not prepare this form. Please retry.');}
  return response.blob();
 }
 const draw=()=>{
  marks.replaceChildren();
  for(const [key,r] of Object.entries(mapping)){
   const box=document.createElement('span');box.className='locator-pilot-mark';if(key===fields[index]?.[0])box.classList.add('current');
   box.style.left=r[0]*100+'%';box.style.top=r[1]*100+'%';box.style.width=r[2]*100+'%';box.style.height=r[3]*100+'%';marks.append(box);
  }
  if(first){const dot=document.createElement('span');dot.className='locator-pilot-point';dot.style.left=first[0]*100+'%';dot.style.top=first[1]*100+'%';marks.append(dot);}
 };
 function field(){
  first=null;draw();
  const [key,label,required]=fields[index];
  $('locatorPilotProgress').textContent='Field '+(index+1)+' of '+fields.length+' · '+(required?'Required':'Optional if not on your form');
  $('locatorPilotPrompt').textContent='Where should the '+label+' appear?';
  $('locatorPilotHint').textContent=mapping[key]?'Space selected. Choose Next field or tap again to adjust.':'Tap the upper-left corner of the blank space, then its lower-right corner.';
  $('locatorPilotSkip').hidden=required;
  $('locatorPilotNext').disabled=!mapping[key];
  $('locatorPilotNext').textContent=index===fields.length-1?'Review sample':'Next field';
  $('locatorPilotBack').textContent=index===0?'Change PDF':'Previous field';
  say('');
 }
 function point(event){
  if(busy||$('locatorPilotStep2').hidden)return;
  const b=image.getBoundingClientRect();
  if(!b.width||!b.height)return;
  const p=[Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))];
  if(!first){first=p;draw();$('locatorPilotHint').textContent='Now tap the lower-right corner of the space.';return;}
  const r=[Math.min(first[0],p[0]),Math.min(first[1],p[1]),Math.abs(first[0]-p[0]),Math.abs(first[1]-p[1])];
  first=null;
  if(r[2]<.012||r[3]<.009){say('Choose a larger space between the two corners.',true);draw();return;}
  const key=fields[index][0];
  if(Object.entries(mapping).some(([k,b])=>k!==key&&r[0]<b[0]+b[2]&&r[0]+r[2]>b[0]&&r[1]<b[1]+b[3]&&r[1]+r[3]>b[1])){say('That space overlaps another field. Choose a separate blank area.',true);draw();return;}
  mapping[key]=r;field();
 }
 async function sample(){
  if(busy)return;
  clearDownload();busy=true;const run=revision;$('locatorPilotNext').disabled=true;say('Checking spaces and preparing sample…');
  try{
   const blob=await request('sample');if(run!==revision)return;
   revoke();sampleUrl=URL.createObjectURL(blob);$('locatorPilotSample').src=sampleUrl;show(3);
   $('locatorPilotVerified').checked=false;$('locatorPilotOutcome').textContent='';
   $('locatorPilotDownload').disabled=false;say('Review the sample. The live Locator Slip has not changed.');
  }catch(e){if(run===revision)say(e.message+' Use Previous field to adjust the spaces.',true);}
  finally{busy=false;if(run===revision)$('locatorPilotNext').disabled=!mapping[fields[index][0]];}
 }
 function advance(skip=false){
  if(busy)return;
  const [key,,required]=fields[index];
  if(skip){if(required)return;delete mapping[key];}
  else if(!mapping[key])return;
  if(index===fields.length-1){void sample();return;}
  index++;field();
 }
 $('locatorPilotOpen').addEventListener('click',()=>{if(busy){say('The current preview is being prepared.');return;}panel.hidden=!panel.hidden;$('locatorPilotOpen').textContent=panel.hidden?'Try guided setup':'Close guided setup';$('locatorPilotOpen').setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden&&!busy)reset();});
 $('locatorPilotFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file||busy)return;
  if(file.size>2*1024*1024||!file.name.toLowerCase().endsWith('.pdf')){say('Choose a blank PDF up to 2 MB.',true);return;}
  busy=true;e.target.disabled=true;say('Preparing your blank form…');const run=++revision;
  try{
   pdf=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Unable to read the file.'));reader.readAsDataURL(file);});
   const blob=await request('blank');if(run!==revision)return;
   const url=URL.createObjectURL(blob);
   try{image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}
   if(run!==revision)return;
   mapping={};index=0;show(2);field();
  }catch(err){if(run===revision){pdf=null;say(err.message,true);}}
  finally{busy=false;e.target.disabled=false;e.target.value='';}
 });
 sheet.addEventListener('click',point);
 $('locatorPilotBack').addEventListener('click',()=>{if(busy)return;if(!index){reset();return;}index--;field();});
 $('locatorPilotNext').addEventListener('click',()=>advance());
 $('locatorPilotSkip').addEventListener('click',()=>advance(true));
 $('locatorPilotEdit').addEventListener('click',()=>{if(busy)return;clearDownload();revoke();show(2);field();});
 $('locatorPilotStartOver').addEventListener('click',()=>{if(!busy)reset();});
 $('locatorPilotDownload').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('locatorPilotDownload').disabled=true;say('Preparing the print-ready sample…');
  try{
   const blob=await request('pdf');
   // The file is never activated. Native sharing is offered as a second
   // user gesture after preparation, preserving mobile user activation.
   const file=new File([blob],'Locator-Slip-SAMPLE.pdf',{type:'application/pdf'});
   const previous=$('locatorPilotSaveFile');previous.replaceChildren();
   const url=URL.createObjectURL(blob);
   const download=document.createElement('a');download.className='outline-button';download.href=url;download.download=file.name;download.textContent='Download sample PDF';previous.append(download);
   if(typeof navigator.share==='function'&&navigator.canShare?.({files:[file]})){
    const share=document.createElement('button');share.type='button';share.className='outline-button';share.textContent='Share / save sample';
    share.addEventListener('click',()=>navigator.share({files:[file]}).catch(()=>say('Use Download sample PDF instead.',true)));previous.append(share);
   }
   download.addEventListener('click',()=>{download.textContent='Download again';});
   previous.dataset.objectUrl&&URL.revokeObjectURL(previous.dataset.objectUrl);previous.dataset.objectUrl=url;
   say('Sample ready. Compare it with your blank form.');
  }catch(e){say(e.message,true);}finally{busy=false;$('locatorPilotDownload').disabled=false;}
 });
 $('locatorPilotVerified').addEventListener('change',()=>{
  $('locatorPilotOutcome').textContent=$('locatorPilotVerified').checked?'Review complete for this session. No template has been saved or activated.':'';
 });
})();
