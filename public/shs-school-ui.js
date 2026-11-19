'use strict';
/* SHS UI extension: school scoped settings and grade selectors only.
 * Never modifies attendance calculation, QR verification, scheduling APIs or permissions. */
(()=>{
 const $=id=>document.getElementById(id);
 const gradeIds=['newGrade','editGrade','batchGrade','bulkQrGrade','periodGrade','adviserNewSectionGrade','academicEnrollmentGrade'];
 const grades=['Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
 const specialOptions=new Map();
 let identity=null,config=null,paths=[];
 const message=(id,value,error=false)=>{
  const el=$(id);if(!el)return;el.textContent=value;el.classList.toggle('error',error);
 };
 function allowed(){
  if(config?.mode==='SHS_ONLY')return grades.slice(4);
  if(config?.mode==='INTEGRATED')return grades;
  return grades.slice(0,4);
 }
 async function api(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,
   headers:{...(options.body?{'Content-Type':'application/json'}:{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'School SHS settings are unavailable.');
  return body;
 }
 function gradeSelects(){
  const available=allowed();
  for(const id of gradeIds){
   const el=$(id);if(!el)continue;
   if(!specialOptions.has(id)){
    specialOptions.set(id,[...el.options].filter(o=>!grades.includes(o.value))
     .map(o=>({value:o.value,label:o.textContent})));
   }
   const selected=el.value,options=specialOptions.get(id);
   el.replaceChildren();
   for(const item of options){
    const option=document.createElement('option');
    option.value=item.value;option.textContent=item.label;el.append(option);
   }
   for(const g of available){
    const option=document.createElement('option');
    option.value=g;option.textContent=g;el.append(option);
   }
   if([...el.options].some(o=>o.value===selected))el.value=selected;
   else if(options.length&&options[0].value==='')el.value='';
   else if(options.length&&options[0].value==='ALL')el.value='ALL';
   else el.value=available[0]||'';
   if(el.value!==selected)el.dispatchEvent(new Event('change',{bubbles:true}));
  }
 }
 function activeYear(){
  const years=config?.schoolYears||[];
  const selected=$('academicSelectedYear')?.value;
  return (years.some(y=>y.schoolYearId===selected)?selected:'')||
    years.find(y=>y.status==='ACTIVE')?.schoolYearId||years[0]?.schoolYearId||'';
 }
 function yearById(id){return (config?.schoolYears||[]).find(y=>y.schoolYearId===id);}
 function selectedCurriculum(){
  const y=$('shsCurriculumYear')?.value,g=$('shsCurriculumGrade')?.value;
  return (config?.curricula||[]).find(c=>c.schoolYearId===y&&c.gradeLevel===g);
 }
 function renderCurriculum(){
  const y=yearById($('shsCurriculumYear')?.value),g=$('shsCurriculumGrade')?.value||'Grade 11';
  const row=selectedCurriculum(),start=Number((y?.label||'').slice(0,4));
  const defaultVersion=g==='Grade 11'&&start>=2026?'STRENGTHENED':'LEGACY';
  $('shsCurriculumVersion').value=row?.version||defaultVersion;
  const isPilot=g==='Grade 12'&&start===2026&&$('shsCurriculumVersion').value==='STRENGTHENED';
  $('shsPilotConfirmationWrap').hidden=!isPilot;
  $('shsGrade12PilotConfirmed').checked=isPilot&&row?.pilotConfirmed===true;
  const oldGrade11=g==='Grade 11'&&start>=2026;
  const legacy=[...$('shsCurriculumVersion').options].find(o=>o.value==='LEGACY');
  if(legacy)legacy.disabled=oldGrade11;
 }
 function chooseCurriculumVersion(){
  const y=yearById($('shsCurriculumYear')?.value);
  const isPilot=$('shsCurriculumGrade').value==='Grade 12'&&Number((y?.label||'').slice(0,4))===2026&&$('shsCurriculumVersion').value==='STRENGTHENED';
  $('shsPilotConfirmationWrap').hidden=!isPilot;
  if(!isPilot)$('shsGrade12PilotConfirmed').checked=false;
 }
 function updateYears(){
  const selected=activeYear();
  for(const id of ['shsCurriculumYear','shsPathYear']){
   const el=$(id);if(!el)continue;
   const old=el.value;
   el.replaceChildren();
   const none=document.createElement('option');none.value='';none.textContent='Choose school year';el.append(none);
   for(const y of config.schoolYears){
    const opt=document.createElement('option');opt.value=y.schoolYearId;
    opt.textContent=y.label+' · '+y.status;el.append(opt);
   }
   el.value=config.schoolYears.some(y=>y.schoolYearId===old)?old:selected;
  }
  renderCurriculum();
 }
 function populatePathSelect(){
  const el=$('shsPathEnrollment');if(!el)return;
  const current=el.value;el.replaceChildren();
  const none=document.createElement('option');none.value='';none.textContent=paths.length?'Choose enrolled SHS learner':'No enrolled SHS learners';el.append(none);
  for(const p of paths){
   const option=document.createElement('option');
   option.value=p.enrollmentId;
   option.textContent=[p.fullName,p.gradeLevel,p.section].filter(Boolean).join(' · ');
   el.append(option);
  }
  if(paths.some(p=>p.enrollmentId===current))el.value=current;
  else el.value='';
  renderLearnerPath();
 }
 function renderLearnerPath(){
  const chosen=paths.find(p=>p.enrollmentId===$('shsPathEnrollment')?.value);
  const y=yearById($('shsPathYear')?.value),start=Number((y?.label||'').slice(0,4));
  const curriculum=(config?.curricula||[]).find(c=>c.schoolYearId===$('shsPathYear')?.value&&c.gradeLevel===chosen?.gradeLevel);
  const version=curriculum?.version||(chosen?.gradeLevel==='Grade 11'&&start>=2026?'STRENGTHENED':'LEGACY');
  const allowedTracks=version==='STRENGTHENED'?['ACADEMIC','TECHPRO']:['ACADEMIC','TVL','SPORTS','ARTS_AND_DESIGN'];
  const el=$('shsPathTrack'),previous=chosen?.track||el.value;
  for(const option of el.options)option.hidden=option.disabled=!allowedTracks.includes(option.value);
  el.value=allowedTracks.includes(previous)?previous:allowedTracks[0];
  $('shsPathStrand').value=chosen?.strand||'';
  $('shsPathStrand').placeholder=version==='STRENGTHENED'?'Elective cluster (if applicable)':'STEM, ABM, HUMSS, GAS or other applicable strand';
 }
 async function loadPaths(){
  const year=$('shsPathYear').value;
  if(!year){paths=[];populatePathSelect();return;}
  const response=await api('/api/shs/enrollment-paths?schoolYearId='+encodeURIComponent(year));
  paths=response.items||[];populatePathSelect();
 }
 async function reload(){
  config=await api('/api/shs/config');
  gradeSelects();
  if(identity.role!=='SCHOOL_ADMIN')return;
  $('shsSchoolConfiguration').hidden=false;
  $('shsSchoolLevelMode').value=config.mode;
  $('shsProgramPanel').hidden=config.mode==='JHS_ONLY';
  updateYears();
  if(config.mode!=='JHS_ONLY')await loadPaths();
 }
 async function saveLevels(event){
  event.preventDefault();
  const mode=$('shsSchoolLevelMode').value,previous=config?.mode;
  if(mode!==previous&&!window.confirm('Update academic levels for this school? Existing learner and timetable records will be preserved; disabling grades with records is blocked.'))return;
  const btn=event.currentTarget.querySelector('[type="submit"]');btn.disabled=true;
  try{
   await api('/api/shs/config',{method:'PUT',body:JSON.stringify({mode})});
   await reload();
   message('shsLevelFeedback','School academic levels saved. Grade options are updated across this school.');
  }catch(error){message('shsLevelFeedback',error.message,true);}
  finally{btn.disabled=false;}
 }
 async function saveCurriculum(event){
  event.preventDefault();
  const btn=event.currentTarget.querySelector('[type="submit"]');btn.disabled=true;
  try{
   const request={schoolYearId:$('shsCurriculumYear').value,gradeLevel:$('shsCurriculumGrade').value,
    version:$('shsCurriculumVersion').value,pilotConfirmed:$('shsGrade12PilotConfirmed').checked};
   await api('/api/shs/curriculum',{method:'PUT',body:JSON.stringify(request)});
   await reload();
   message('shsCurriculumFeedback','SHS curriculum saved for the chosen grade and school year.');
  }catch(error){message('shsCurriculumFeedback',error.message,true);}
  finally{btn.disabled=false;}
 }
 async function savePath(event){
  event.preventDefault();
  const btn=event.currentTarget.querySelector('[type="submit"]');btn.disabled=true;
  try{
   const id=$('shsPathEnrollment').value;
   if(!id)throw Error('Choose an enrolled Grade 11 or Grade 12 learner first.');
   await api('/api/shs/enrollment-paths/'+encodeURIComponent(id),
    {method:'PUT',body:JSON.stringify({track:$('shsPathTrack').value,strand:$('shsPathStrand').value})});
   await loadPaths();
   $('shsPathEnrollment').value=id;renderLearnerPath();
   message('shsPathFeedback','Learner track and pathway saved without changing student identity or attendance.');
  }catch(error){message('shsPathFeedback',error.message,true);}
  finally{btn.disabled=false;}
 }
 window.attendigoStaffIdentity?.then(async user=>{
  identity=user;
  if(!['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'].includes(user?.role))return;
  try{await reload();}
  catch(error){if(user.role==='SCHOOL_ADMIN')message('shsLevelFeedback',error.message,true);}
  if(user.role!=='SCHOOL_ADMIN')return;
  $('shsLevelForm')?.addEventListener('submit',saveLevels);
  $('shsCurriculumForm')?.addEventListener('submit',saveCurriculum);
  $('shsLearnerPathForm')?.addEventListener('submit',savePath);
  $('shsCurriculumGrade')?.addEventListener('change',renderCurriculum);
  $('shsCurriculumYear')?.addEventListener('change',renderCurriculum);
  $('shsCurriculumVersion')?.addEventListener('change',chooseCurriculumVersion);
  $('shsPathYear')?.addEventListener('change',()=>loadPaths().catch(e=>message('shsPathFeedback',e.message,true)));
  $('shsPathEnrollment')?.addEventListener('change',renderLearnerPath);
  $('shsPathRefresh')?.addEventListener('click',()=>loadPaths().then(()=>message('shsPathFeedback','SHS learner list refreshed.')).catch(e=>message('shsPathFeedback',e.message,true)));
  document.addEventListener('attendigo:open-academic',()=>reload().catch(e=>message('shsLevelFeedback',e.message,true)));
 }).catch(()=>{});
})();
