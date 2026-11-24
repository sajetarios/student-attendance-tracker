'use strict';
// Compact School Admin daily review. No attendance/OB edits and no biometric claims.
(() => {
 const $=id=>document.getElementById(id);
 const api=async(url,options={})=>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Unable to load attendance.');
  return result;
 };
 function todayManila(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()).map(part=>[part.type,part.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
 }
 function init(user){
  if(user?.role!=='SCHOOL_ADMIN'||!$('smartAttendanceOverview'))return;
  const date=$('smartAttendanceDate'),refresh=$('smartAttendanceRefresh');
  const status=$('smartAttendanceStatus'),items=$('smartAttendanceItems');
  const other=$('smartAttendanceOther'),otherItems=$('smartAttendanceOtherItems');
  const hoursDetails=$('smartAttendanceHours'),hoursLabel=$('smartAttendanceHoursSummary');
  const hoursFeedback=$('smartHoursFeedback'),save=$('smartHoursSave');
  const preset=$('smartHoursPreset'),insights=$('form48DailyInsights');
  const workdaysControl=$('smartHoursWorkdays'),workdaysLabel=$('smartHoursWorkdaysLabel');
  const fields=['smartHoursAmIn','smartHoursAmOut','smartHoursPmIn','smartHoursPmOut'].map($);
  const presets={'6-3':['06:00','11:00','12:00','15:00'],
   '7-4':['07:00','12:00','13:00','16:00'],
   '8-5':['08:00','12:00','13:00','17:00']};
  $('form48OpenHours')?.addEventListener('click',()=>{
   if(insights)insights.open=true;
   if(hoursDetails)hoursDetails.open=true;
   hoursDetails?.scrollIntoView?.({behavior:'smooth',block:'start'});
  });
  let revision=0,defaults=null,busy=false,customSchedule=false;
  const say=(message,error=false)=>{
   status.textContent=message;status.classList.toggle('is-error',error);
  };
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&
   Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
   new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  date.value=todayManila();date.max=todayManila();
  function row(item){
   const el=document.createElement('div'),main=document.createElement('div');
   const name=document.createElement('strong'),description=document.createElement('p');
   const side=document.createElement('div'),count=document.createElement('small');
   el.className='smart-attendance-person';
   name.textContent=item.name;
   description.textContent=item.message;
   count.textContent=String(item.gateCount)+' gate scans · '+String(item.dtrCount)+'/4 official times'+(item.documentedCount?' · '+item.documentedCount+' documented':'');
   main.append(name,description);side.append(count);
   if(item.status==='review'||item.status==='pending'){
    const open=document.createElement('button');
    open.type='button';open.className='outline-button';open.textContent='Review details';
    open.addEventListener('click',()=>{
     const person=$('form48Employee'),month=$('form48Month');
     if(!person||!month||![...person.options].some(option=>option.value===item.staffUserId)){
      say('Employee list is loading. Choose the employee below to review the DTR.',true);return;
     }
     month.value=date.value.slice(0,7);
     person.value=item.staffUserId;
     person.dispatchEvent(new Event('change',{bubbles:true}));
     month.dispatchEvent(new Event('change',{bubbles:true}));
     const gateDetails=$('form48GateIntelligence'),day=$('form48GateReviewDate');
     if(gateDetails)gateDetails.open=true;
     if(day){day.value=date.value;day.dispatchEvent(new Event('change',{bubbles:true}));}
     $('form48GateReviewButton')?.click();
     gateDetails?.scrollIntoView?.({behavior:'smooth',block:'start'});
    });
    side.append(open);
   }
   el.append(main,side);return el;
  }
  function display(data){
   if(data.safeToApply!==false)throw Error('Unexpected data: attendance review stopped.');
   $('smartAttendanceScans').textContent=String(data.verifiedGateEvents||0);
   $('smartAttendanceReviewCount').textContent=String(data.reviewCount||0);
   $('smartAttendancePendingCount').textContent=String(data.pendingCount||0);
   items.replaceChildren();otherItems.replaceChildren();
   const rows=Array.isArray(data.items)?data.items:[];
   const urgent=rows.filter(x=>x.status==='review'||x.status==='pending');
   const notes=rows.filter(x=>x.status==='info');
   if(urgent.length){
    urgent.slice(0,50).forEach(x=>items.append(row(x)));
    if(urgent.length>50){
     const foot=document.createElement('p');
     foot.textContent='Showing 50 of '+urgent.length+' items. Check the records directly for more.';
     items.append(foot);
    }
   }else{
    const empty=document.createElement('p');
    empty.className='smart-attendance-all-clear';
    empty.textContent='No urgent scan exceptions found in the recorded evidence for this date.';
    items.append(empty);
   }
   other.hidden=!notes.length;
   notes.forEach(x=>otherItems.append(row(x)));
   if(!data.schoolHoursConfigured){
    say('Checked '+data.date+'. School default schedule is incomplete; staff-specific schedules still apply.');
   }else{
    say('Checked '+data.date+'. Review only the outstanding items.');
   }
  }
  async function load(){
   if(!validDate(date.value)||date.value>todayManila()){
    say('Choose a valid school date up to today.',true);return;
   }
   const token=++revision,selected=date.value;
   refresh.disabled=true;say('Checking verified attendance scans and existing DTR records…');
   try{
    const data=await api('/api/staff-attendance/admin/smart-overview?'+new URLSearchParams({date:selected}));
    if(token!==revision||selected!==date.value)return;
    display(data);
   }catch(err){
    if(token!==revision)return;
    items.replaceChildren();other.hidden=true;
    say(err.message||'Unable to load attendance overview.',true);
   }finally{if(token===revision)refresh.disabled=false;}
  }
  function readHours(){
   return {AM_IN:fields[0].value,AM_OUT:fields[1].value,
    PM_IN:fields[2].value,PM_OUT:fields[3].value};
  }
  const mins=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value||'')
   ?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
  function completeHours(){
   const values=Object.values(readHours()).map(mins);
   return values.every(Number.isInteger)&&values[0]<values[1]&&
    values[1]<=values[2]&&values[2]<values[3];
  }
  const savedDays=()=>Array.isArray(defaults?.workdays)?defaults.workdays:[];
  const selectedDays=()=>savedDays().length?savedDays():workdaysControl?.value==='weekdays'?[1,2,3,4,5]:[];
  function scheduleLabel(){
   if(!savedDays().length)return completeHours()?'Hours saved · choose workdays':'Choose workdays & hours';
   if(!completeHours())return 'Regular hours needed';
   if(savedDays().includes(6)){const h=defaults?.saturdayHours||{},v=['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>mins(h[k]));if(!v.every(Number.isInteger)||!(v[0]<v[1]&&v[1]<=v[2]&&v[2]<v[3]))return 'Saturday hours needed';}
   return customSchedule?'Custom days · hours set':'Set for Monday–Friday';
  }
  function updateSave(){
   const locked=busy||!defaults;
   fields.forEach(field=>{field.disabled=locked;});
   if(preset)preset.disabled=locked;
   if(workdaysControl)workdaysControl.disabled=locked;
   save.disabled=locked||!completeHours()||!selectedDays().length;
  }
  async function loadDefaults(){
   defaults=null;updateSave();
   hoursFeedback.textContent='Loading existing school hours…';
   try{
    const result=await api('/api/staff-attendance/admin/form48/defaults');
    defaults=result.defaults;
    const workdays=Array.isArray(defaults.workdays)?defaults.workdays:[];
    customSchedule=workdays.length!==5||![1,2,3,4,5].every(day=>workdays.includes(day));
    const r=defaults.regularHours||{};
    ['AM_IN','AM_OUT','PM_IN','PM_OUT'].forEach((slot,i)=>{
     fields[i].value=r[slot]||'';
    });
    if(preset){
     preset.value=Object.entries(presets).find(([,times])=>times.every((t,i)=>fields[i].value===t))?.[0]||
       (completeHours()?'custom':'');
    }
    if(workdaysLabel)workdaysLabel.hidden=workdays.length>0;
    if(workdaysControl)workdaysControl.value='';
    hoursLabel.textContent=scheduleLabel();
    hoursFeedback.textContent=customSchedule
     ?(completeHours()
       ?'These regular-day hours are saved. Your custom working days and Saturday hours are already configured.'
       :'Your school uses custom working days. Set the approved regular-day hours here; existing workdays and Saturday hours will remain unchanged.')
     :completeHours()
      ?'These hours apply by default to staff without a separate saved schedule.'
      :'Enter the four official Monday–Friday times, then save once for the school.';
    if(!workdays.length)hoursFeedback.textContent='Regular hours may already be saved, but no school workdays are configured. Select the approved workdays before saving.';
    else if(hoursLabel.textContent==='Saturday hours needed')hoursFeedback.textContent='Regular hours are saved. Configure the approved Saturday hours using the detailed work schedule settings.';
    updateSave();
   }catch(err){
    defaults=null;save.disabled=true;
    hoursFeedback.textContent='Could not load school settings: '+err.message;
   }
  }
  save.addEventListener('click',async()=>{
   if(busy||!defaults||!completeHours()||!selectedDays().length)return;
   if(!window.confirm(savedDays().length?'Save these approved regular-day working hours? Your configured working days, Saturday hours, staff-specific schedules, and recorded DTR punches will remain unchanged.':'Set Monday–Friday as the approved school workdays and save these hours? Existing staff-specific schedules and DTR punches will remain unchanged.'))return;
   busy=true;updateSave();hoursFeedback.textContent='Saving school working hours…';
   try{
    const current=defaults,submittedHours=readHours(),submittedDays=selectedDays();
    const result=await api('/api/staff-attendance/admin/form48/defaults',{
     method:'PUT',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...current,revision:current.revision,
      regularHours:submittedHours,workdays:submittedDays})
    });
    defaults={...current,regularHours:submittedHours,workdays:submittedDays,revision:result.revision};
    customSchedule=submittedDays.length!==5||![1,2,3,4,5].every(day=>submittedDays.includes(day));
    if(workdaysLabel)workdaysLabel.hidden=true;
    hoursLabel.textContent=scheduleLabel();
    hoursFeedback.textContent='School working hours saved. Existing working days, Saturday hours, and attendance punches were preserved.';
    await load();
   }catch(err){
    hoursFeedback.textContent='Nothing was saved: '+err.message;
    await loadDefaults();
   }finally{busy=false;updateSave();}
  });
  preset?.addEventListener('change',()=>{
   const hours=presets[preset.value];
   if(hours)hours.forEach((time,i)=>{fields[i].value=time;});
   updateSave();
   hoursFeedback.textContent=hours
    ?'Preset selected. Check all four times, then Save to confirm your school policy.'
    :'Enter the school-approved hours before saving.';
  });
  fields.forEach(field=>{
   const changed=()=>{
    if(preset)
     preset.value=Object.entries(presets).find(([,times])=>times.every((t,i)=>fields[i].value===t))?.[0]||'custom';
    updateSave();
   };
   field.addEventListener('input',changed);field.addEventListener('change',changed);
  });
  document.addEventListener('attendigo:dashboard-refresh',event=>{if(!$('dashboardView')?.hidden)event.detail.tasks.push(load());});
  workdaysControl?.addEventListener('change',updateSave);
  document.addEventListener('attendigo:dtr-verified',load);
  document.addEventListener('attendigo:requests-changed',()=>{if(insights?.open)void load();});
  insights?.addEventListener('toggle',()=>{if(insights.open)void load();});
  refresh.addEventListener('click',load);
  date.addEventListener('change',load);
  loadDefaults();load();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
