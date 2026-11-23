'use strict';
/* Read-only teacher priorities inside existing shortcuts, never a new module. */
(() => {
  const $ = id => document.getElementById(id);
  const API = '/api/teacher/today-overview';
  const toTime = value => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''))) return 'Time unavailable';
    const [hour,minute] = value.split(':').map(Number);
    return (hour%12||12)+':'+String(minute).padStart(2,'0')+(hour>=12?' PM':' AM');
  };
  const go = destination => {
    const link = destination==='classAttendance'
      ? $('classAttendanceNav') : $('quickActionsCard')?.querySelector('[data-go="'+destination+'"]');
    if (!link || link.hidden || link.disabled) return false;
    link.click();
    return true;
  };
  let requestNo=0;
  function init(user) {
    if(user?.role!=='TEACHER')return;
    const card=$('quickActionsCard');
    if(!card||card.querySelector('#teacherTodayOverview'))return;
    const section=document.createElement('section');
    section.className='teacher-today-overview';
    section.id='teacherTodayOverview';
    section.setAttribute('aria-labelledby','teacherTodayHeading');
    section.innerHTML=[
      '<div class="teacher-today-heading"><div><h4 id="teacherTodayHeading">Today\'s Teaching Overview</h4>',
      '<p id="teacherTodayDate">Your live teaching priorities</p></div>',
      '<span id="teacherTodayState" class="teacher-today-state">Checking</span></div>',
      '<div class="teacher-today-actions">',
      '<button type="button" class="teacher-today-item" id="teacherTodaySchedule">',
      '<span class="teacher-today-symbol" aria-hidden="true">▦</span>',
      '<span class="teacher-today-copy"><strong>Next Scheduled Class</strong>',
      '<small id="teacherTodayScheduleValue">Checking your effective timetable…</small></span>',
      '<span class="teacher-today-chevron" aria-hidden="true">›</span></button>',
      '<button type="button" class="teacher-today-item" id="teacherTodayAttendance">',
      '<span class="teacher-today-symbol" aria-hidden="true">✓</span>',
      '<span class="teacher-today-copy"><strong>Attendance Requiring Attention</strong>',
      '<small id="teacherTodayAttendanceValue">Checking verified records and this device…</small></span>',
      '<span class="teacher-today-chevron" aria-hidden="true">›</span></button>',
      '<button type="button" class="teacher-today-item" id="teacherTodaySf2" hidden>',
      '<span class="teacher-today-symbol" aria-hidden="true">▤</span>',
      '<span class="teacher-today-copy"><strong>Official SF2 Status</strong>',
      '<small id="teacherTodaySf2Value">Checking adviser submissions…</small></span>',
      '<span class="teacher-today-chevron" aria-hidden="true">›</span></button>',
      '</div><p class="teacher-today-footnote">',
      'Read-only summary · Open a module to review or update records.</p>'
    ].join('');
    card.append(section);
    // Keep authorized data-go routes in the DOM for the overview cards, but not as duplicate visible shortcuts.
    card.classList.add('teacher-overview-only');
    const schedule=$('teacherTodaySchedule'),attendance=$('teacherTodayAttendance'),sf2=$('teacherTodaySf2');
    schedule.disabled=!card.querySelector('[data-go="schedules"]:not([hidden])');
    sf2.disabled=!card.querySelector('[data-go="sf2"]:not([hidden])');
    schedule.addEventListener('click',()=>go('schedules'));
    sf2.addEventListener('click',()=>go('sf2'));
    let attentionTarget='classAttendance';
    attendance.addEventListener('click',()=>{
      if(attentionTarget==='queue'&&window.AttendigoOffline?.showQueue){
        window.AttendigoOffline.showQueue();return;
      }
      go('classAttendance');
    });
    const show = (id,value) => {const el=$(id);if(el)el.textContent=value;};
    async function localQueue(){
      const api=window.AttendigoOffline;
      if(!api?.snapshot)return {unknown:true,waiting:0};
      try{
        const snap=await api.snapshot();
        return {
          unknown:false,
          waiting:Number(snap.byType?.MANUAL_MARKS||0)+Number(snap.byType?.REGISTER_SIGNOFF||0)
        };
      }catch{return {unknown:true,waiting:0};}
    }
    async function refresh(){
      const current=++requestNo;
      show('teacherTodayState','Checking');
      let token;
      try{token=sessionStorage.getItem('schoolAttendance.accessToken');}
      catch{return;}
      if(!token)return;
      const queuePromise=localQueue();
      try{
        const response=await fetch(API,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
        if(!response.ok)throw Error('Overview temporarily unavailable');
        const data=await response.json();
        if(current!==requestNo||!card.isConnected)return;
        if(data.asOfDate){
          const asOf=new Date(data.asOfDate+'T12:00:00+08:00');
          const label=Number.isNaN(asOf.getTime())?'Today'
            :asOf.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'short',day:'numeric'});
          show('teacherTodayDate',label+' · Official school records');
        }
        const next=data.nextClass;
        if(next){
          const line=(next.subject||'Class')+' · '+(next.gradeLevel||'')+
            ' '+(next.section||'')+' · '+toTime(next.startTime)+'–'+toTime(next.endTime);
          show('teacherTodayScheduleValue',(next.inProgress?'In progress · ':'')+line);
        }else{
          show('teacherTodayScheduleValue',data.scheduleMessage||'No upcoming assigned periods today.');
        }
        const conflicts=Number(data.attendance?.verifiedConflictsToday||0);
        const unsigned=Number(data.attendance?.completedUnsignedToday||0);
        const local=await queuePromise;
        if(current!==requestNo||!card.isConnected)return;
        const parts=[];
        if(conflicts>0)parts.push(conflicts+' QR/manual conflict'+(conflicts===1?'':'s'));
        if(unsigned>0)parts.push(unsigned+' completed register'+(unsigned===1?'':'s')+' awaiting sign-off');
        if(local.waiting>0)parts.push(local.waiting+' unsynced class item'+(local.waiting===1?'':'s')+' on this device');
        if(!parts.length)parts.push('No verified conflicts or outstanding completed-class sign-offs today');
        if(local.unknown)parts.push('Device sync not checked');
        show('teacherTodayAttendanceValue',parts.join(' · '));
        attentionTarget=conflicts||unsigned?'classAttendance':local.waiting?'queue':'classAttendance';
        attendance.disabled=attentionTarget==='queue'
          ? !window.AttendigoOffline?.showQueue
          : !$('classAttendanceNav')||$('classAttendanceNav').hidden;
        const counts=data.sf2||{};
        sf2.hidden=!(Number(counts.sections)>0);
        if(!sf2.hidden){
          const n=Number(counts.sections||0),done=Number(counts.submitted||0),collected=Number(counts.collected||0);
          const not=Number(counts.notSubmitted||0);
          show('teacherTodaySf2Value',counts.month+' · '+n+' advisory section'+(n===1?'':'s')+
            ' · '+(done+collected)+' submitted'+(collected?' ('+collected+' collected)':'')+
            (not?' · '+not+' not submitted':''));
          sf2.disabled=!card.querySelector('[data-go="sf2"]:not([hidden])');
        }
        show('teacherTodayState','Updated');
      }catch{
        if(current!==requestNo||!card.isConnected)return;
        show('teacherTodayState','Unavailable');
        show('teacherTodayScheduleValue','Live timetable unavailable. Open My Timetable to verify.');
        show('teacherTodayAttendanceValue','Unable to check verified records. Open Class Attendance to review.');
        sf2.hidden=true;
      }
    }
    refresh();
    const retryIfVisible=()=>{
      if(!document.hidden&&!$('dashboardView')?.hidden)refresh();
    };
    window.addEventListener('focus',retryIfVisible);
    window.addEventListener('online',retryIfVisible);
    document.addEventListener('visibilitychange',retryIfVisible);
    const dashboard=$('dashboardView');
    if(dashboard&&typeof MutationObserver!=='undefined'){
      new MutationObserver(retryIfVisible).observe(dashboard,{attributes:true,attributeFilter:['hidden']});
    }
  }
  if(window.attendigoStaffIdentity?.then)window.attendigoStaffIdentity.then(init).catch(()=>{});
})();