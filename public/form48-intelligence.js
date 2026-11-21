'use strict';
// School Admin: read-only explanation of verified gate evidence beside Form 48.
// Never create an official DTR slot, OB approval, attendance correction, or audit entry.
(() => {
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const slotNames={AM_IN:'AM Time-In',AM_OUT:'AM Time-Out',PM_IN:'PM Time-In',PM_OUT:'PM Time-Out'};
 const reasons={
  SCHEDULE_UNAVAILABLE:'Configure the employee’s official work hours before reviewing gate evidence.',
  GATE_HISTORY_AMBIGUOUS:'Gate movements are out of order, repeated, or missing a matching entry/exit.',
  OB_INTERVAL_AMBIGUOUS:'The approved OB interval requires a separate date or time review.',
  OB_BOUNDARY_GATE_MOVEMENT:'A gate movement overlaps approved OB hours; do not classify it as lunch or an ordinary DTR punch.',
  OB_RETURN_AFTER_APPROVED_END_REVIEW:'Verified gate re-entry occurred after an approved OB interval. Confirm the circumstances; no overtime is inferred.',
  POST_OB_RETURN_MOVEMENT_REVIEW:'Movements following the late OB return require review before any DTR interpretation.',
  OB_COVERAGE_REQUIRES_REVIEW:'Approved OB is authorization, not evidence of a Form 48 clock punch.',
  OUTSIDE_SCHEDULE_WINDOW:'A scan is too far from the prescribed clock boundary to suggest a DTR slot.',
  AMBIGUOUS_SCHEDULE_SLOT:'The scan is equally plausible for AM and PM based on the configured work hours.',
  DUPLICATE_SLOT_CANDIDATES:'Multiple different gate movements could match the same DTR slot; no candidate is selected.',
  SLOT_ALREADY_VERIFIED:'An official verified DTR slot already exists and cannot be replaced by a gate suggestion.',
  CALENDAR_EXCEPTION_REQUIRES_REVIEW:'The school calendar has a closure or shortened day; review the applicable schedule first.',
  NOT_SCHEDULED_WORKDAY:'The selected date is not a scheduled workday for this employee.'
 };
 function todayInManila(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
 }
 const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
 function init(user){
  if(user?.role!=='SCHOOL_ADMIN')return;
  const person=$('form48Employee'),month=$('form48Month');
  const day=$('form48GateReviewDate'),button=$('form48GateReviewButton');
  const status=$('form48GateReviewStatus'),host=$('form48GateReviewResult');
  if(!person||!month||!day||!button||!status||!host)return;
  let revision=0,loading=false;
  const say=(message,error=false)=>{
   status.textContent=message;
   status.classList.toggle('is-error',Boolean(error));
  };
  function validSelection(){
   return Boolean(person.value&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)&&
    validDate(day.value)&&day.value.slice(0,7)===month.value&&
    day.value<=todayInManila()&&day.value>=day.min&&day.value<=day.max);
  }
  function clear(){
   revision++;loading=false;host.replaceChildren();
   button.disabled=!validSelection();
   say(person.value&&month.value?'Select a school date and choose Review evidence.':'Choose an employee and month first.');
  }
  function resetDay(){
   const value=month.value;
   const today=todayInManila();
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){
    day.value='';day.min='';day.max='';day.disabled=true;clear();return;
   }
   const [year,number]=value.split('-').map(Number);
   const end=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
   day.min=value+'-01';
   day.max=end<today?end:today;
   day.value=day.min<=day.max?day.max:'';
   day.disabled=!day.value;
   clear();
  }
  function render(data){
   // Data is explanatory evidence only; a server release must not promote it
   // into official DTR records through this view.
   if(data.safeToApply!==false)throw Error('Unexpected attendance preview status. No changes made.');
   const verified=data.existingSlots||{},suggestions=data.suggestions||{};
   const reviews=Array.isArray(data.review)?data.review:[];
   const slotMarkup=Object.keys(slotNames).map(slot=>{
    const official=verified[slot],candidate=suggestions[slot]?.time;
    const kind=official?'Verified official DTR':candidate?'Suggested gate evidence':'No verified DTR slot';
    const time=official||candidate||'—';
    return '<div class="form48-intelligence-slot"><span>'+esc(slotNames[slot])+'</span>'+
      '<strong>'+esc(time)+'</strong><small>'+esc(kind)+'</small></div>';
   }).join('');
   const flags=reviews.length?'<ul class="form48-intelligence-flags">'+reviews.map(reason=>
    '<li>'+esc(reasons[reason]||'Unrecognized review reason. Ask the School Administrator to verify the source.')+'</li>'
   ).join('')+'</ul>':
    '<p class="form48-intelligence-empty">No rule-based exceptions were found in the available gate evidence. Missing official punches still require verification.</p>';
   const count=Number(data.gateEventCount)||0,obCount=Number(data.approvedObCount)||0;
   host.innerHTML='<div class="form48-intelligence-counts">'+esc(count)+' verified gate movement(s) · '+
    esc(obCount)+' approved OB interval(s) · '+esc(data.date||day.value)+'</div>'+
    '<div class="form48-intelligence-slots">'+slotMarkup+'</div>'+
    '<h5>Evidence requiring attention</h5>'+flags+
    (count===0?'<p class="form48-intelligence-empty">No gate evidence was found for this date. This is not proof of absence.</p>':'')+
    '<p class="form48-intelligence-disclaimer">Read-only preview. Suggested gate times are not official Form 48 punches, attendance credit, or proof of completed OB. No record was changed.</p>';
  }
  async function load(){
   if(loading||!validSelection())return;
   const token=++revision,personId=person.value,monthValue=month.value,schoolDate=day.value;
   loading=true;button.disabled=true;host.replaceChildren();say('Checking verified gate movements and DTR evidence…');
   try{
    const params=new URLSearchParams({staffUserId:personId,date:schoolDate});
    const response=await fetch('/api/staff-attendance/admin/dtr-reconciliation-preview?'+params,
     {method:'GET',credentials:'same-origin',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(token!==revision||person.value!==personId||month.value!==monthValue||day.value!==schoolDate)return;
    if(!response.ok)throw Error(data.error||'Unable to load the attendance review.');
    render(data);
    say('Review loaded for '+schoolDate+'. Official DTR records were not modified.');
   }catch(error){
    if(token!==revision)return;
    host.replaceChildren();say(error.message||'Unable to load the attendance review.',true);
   }finally{
    if(token===revision){loading=false;button.disabled=!validSelection();}
   }
  }
  person.addEventListener('change',clear);
  month.addEventListener('change',resetDay);
  day.addEventListener('change',clear);
  button.addEventListener('click',load);
  resetDay();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
