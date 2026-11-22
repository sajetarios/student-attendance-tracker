/* Choose a teacher's currently running class using the school's Manila clock.
   Pure & conservative: unknown/ambiguous/closed timetables never auto-select.
   Server-side class membership and attendance permissions remain authoritative. */
(function(root){
 'use strict';
 const zone='Asia/Manila';
 const clockOk=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value.slice(0,5));
 const minutes=value=>clockOk(value)?Number(value.slice(0,2))*60+Number(value.slice(3,5)):null;
 function schoolNow(input=new Date()){
  const now=new Date(input);
  if(!Number.isFinite(now.getTime()))return null;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  return {date,time,weekday:new Date(date+'T00:00:00Z').getUTCDay()};
 }
 function resolve(input){
  const {periods,adjustments,exceptions,operatingDays,teacherUserId,now}=input||{};
  const stamp=schoolNow(now||new Date());
  if(!stamp||!String(teacherUserId||'').trim()||![periods,adjustments,exceptions,operatingDays].every(Array.isArray))
   return {status:'UNAVAILABLE',today:[],active:[],stamp};
  const exception=exceptions.find(row=>row.date===stamp.date)||null;
  if(exception?.type==='CLOSED')return {status:'CLOSED',today:[],active:[],stamp};
  const special=exception&&['OPEN','SPECIAL_CLASS'].includes(exception.type);
  const allowed=Array.isArray(exception?.periodIds)?exception.periodIds.map(String):[];
  const weekday=stamp.weekday;
  const settings=operatingDays.find(row=>Number(row.weekday)===weekday);
  if(settings&&settings.isOperatingDay===false&&!special)
   return {status:'NON_OPERATING',today:[],active:[],stamp};
  const t=minutes(stamp.time);
  if(exception?.type==='SHORTENED_DAY'&&minutes(exception.dismissalTime)!==null&&
    t>=minutes(exception.dismissalTime))
   return {status:'DISMISSED',today:[],active:[],stamp};
  const today=[];
  for(const period of periods){
   if(!period||!period.periodId||!Array.isArray(period.weekdays))continue;
   // Administrators can authorize selected subject periods on special
   // operating dates outside the normal recurring weekday.
   if(!period.weekdays.map(Number).includes(weekday)&&!special)continue;
   if(period.effectiveFrom&&String(period.effectiveFrom).slice(0,10)>stamp.date)continue;
   if(period.effectiveTo&&String(period.effectiveTo).slice(0,10)<stamp.date)continue;
   if(['ADVISORY','HOMEROOM','BREAK','LUNCH'].includes(String(period.scheduleType||'').toUpperCase()))continue;
   if(special&&!allowed.includes(String(period.periodId)))continue;
   const change=adjustments.find(row=>String(row.periodId)===String(period.periodId)&&row.date===stamp.date);
   if(change?.type==='CANCEL')continue;
   // Date-specific substitute assignments override the regular teacher.
   // Do not auto-attribute a substitute's class to the original teacher.
   const owner=change?.type==='SUBSTITUTE'&&change.teacherUserId
      ?change.teacherUserId:period.assignedTeacherUserId;
   if(String(owner||'')!==String(teacherUserId))continue;
   const startTime=(change?.startTime||period.startTime||'').slice(0,5);
   const endTime=(change?.endTime||period.endTime||'').slice(0,5);
   const start=minutes(startTime),end=minutes(endTime);
   if(start===null||end===null||end<=start)continue;
   today.push({...period,startTime,endTime,
     subjectName:change?.subjectName||period.subjectName,
     isAdjusted:Boolean(change)});
  }
  today.sort((a,b)=>a.startTime.localeCompare(b.startTime)||String(a.periodId).localeCompare(String(b.periodId)));
  const active=t===null?[]:today.filter(row=>minutes(row.startTime)<=t&&t<minutes(row.endTime));
  return {status:active.length===1?'MATCH':active.length>1?'AMBIGUOUS':today.length?'NO_ACTIVE':'NO_CLASS',
   today,active,stamp};
 }
 const api=Object.freeze({schoolNow,resolve});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.AttendigoTeacherScannerSchedule=api;
})(typeof window!=='undefined'?window:null);
