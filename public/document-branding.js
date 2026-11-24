'use strict';
(()=>{
 const $=id=>document.getElementById(id),view=$('schoolBrandingView'),form=$('documentBrandingForm');
 if(!view||!form)return;
 const fields=$('documentBrandingFields'),status=$('documentBrandingStatus'),keys=['region','division','address','officialSchoolId','layout'];
 let saved=null,agencyChange,loading=false,busy=false,selection=0,processing=false;
 const token=()=>sessionStorage.getItem('schoolAttendance.accessToken')||'';
 async function request(method='GET',body){
  const t=token(),response=await fetch('/api/school/document-branding',{method,credentials:'same-origin',cache:'no-store',
   headers:{...(t?{Authorization:'Bearer '+t}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Document identity is unavailable.');
  return data.branding;
 }
 const settings=()=>Object.fromEntries(keys.map(key=>[key,form.elements.namedItem(key).value]));
 function preview(){
  if(!saved)return;
  const s=settings(),agency=agencyChange===undefined?saved.agencyLogo:agencyChange===null?null:'data:image/png;base64,'+agencyChange;
  const school=saved.schoolLogo;
  let left=null,right=null;
  if(s.layout==='AUTO')left=agency||school;
  if(s.layout==='DUAL'){left=agency||school;right=agency&&school?school:null;}
  if(s.layout==='AGENCY')left=agency;
  if(s.layout==='SCHOOL')left=school;
  for(const [id,src] of [['documentPreviewLeft',left],['documentPreviewRight',right]]){
   const image=$(id);image.hidden=!src;
   image.onerror=()=>{image.hidden=true;};if(src)image.src=src;else image.removeAttribute('src');
  }
  for(const [id,value] of [['documentPreviewSchool',saved.schoolName],['documentPreviewRegion',s.region],['documentPreviewDivision',s.division],['documentPreviewAddress',s.address],['documentPreviewId',s.officialSchoolId?'School ID: '+s.officialSchoolId:'']])$(id).textContent=value||'';
 }
 function reset(){
  if(!saved)return;
  selection++;processing=false;agencyChange=undefined;$('documentAgencyFile').value='';
  for(const key of keys)form.elements.namedItem(key).value=saved[key]|| (key==='layout'?'AUTO':'');
  preview();
 }
 async function load(){
  if(loading||busy||view.hidden)return;
  loading=true;fields.disabled=true;status.textContent='Loading document identity…';
  try{saved=await request();reset();fields.disabled=false;status.textContent='';}
  catch(e){status.textContent=e.message+' Reopen School Identity to retry.';}
  finally{loading=false;}
 }
 new MutationObserver(()=>{if(!view.hidden)load();}).observe(view,{attributes:true,attributeFilter:['hidden']});
 if(!view.hidden)load();
 form.addEventListener('input',preview);
 $('documentBrandReset').addEventListener('click',()=>{reset();status.textContent='Unsaved changes reset.';});
 $('documentAgencyRemove').addEventListener('click',()=>{selection++;processing=false;agencyChange=null;$('documentAgencyFile').value='';preview();status.textContent='Logo removed from preview. Save to apply.';});
 $('documentAgencyFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const current=++selection;processing=true;status.textContent='Preparing logo…';
  let url;
  try{
   if(file.size>12*1024*1024)throw Error('Choose an image up to 12 MB.');
   url=URL.createObjectURL(file);const img=new Image();
   img.src=url;await img.decode();
   if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>25000000)throw Error('Choose a smaller image.');
   const scale=Math.min(1,640/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
   const data=canvas.toDataURL('image/png');
   if(current!==selection)return;
   agencyChange=data.split(',')[1];preview();status.textContent='Logo preview ready. Save to apply.';
  }catch(e){if(current===selection){status.textContent='Could not prepare this image. Use a readable PNG, JPEG or WebP. '+e.message;event.target.value='';}}
  finally{if(url)URL.revokeObjectURL(url);if(current===selection)processing=false;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!saved||busy)return;
  if(processing){status.textContent='Logo is still being prepared.';return;}
  busy=true;fields.disabled=true;status.textContent='Saving document identity…';
  try{saved=await request('PUT',{...settings(),...(agencyChange!==undefined?{agencyLogo:agencyChange}:{})});reset();status.textContent='Document identity saved.';}
  catch(e){status.textContent=e.message;}
  finally{busy=false;fields.disabled=false;}
 });
})();
