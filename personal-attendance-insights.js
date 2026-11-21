'use strict';
// Review-only daily suggestions using existing verified physical gate and DTR evidence.
// Never mutate attendance, infer an absence, or treat approved OB as a clock punch.
const {reconcileGateDay}=require('./gate-dtr-reconciliation');
const ZONE='Asia/Manila';
const dateParts=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const timeParts=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const SLOTS=new Set(['AM_IN','AM_OUT','PM_IN','PM_OUT']);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&
 Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
 new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function localDate(value){
 const when=new Date(value);
 if(!Number.isFinite(when.getTime()))return null;
 const parts=Object.fromEntries(dateParts.formatToParts(when).map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function localTime(value){
 const when=new Date(value);
 return Number.isFinite(when.getTime())?timeParts.format(when):null;
}
function summarizePersonalAttendance({from,to,dtrEvents=[],gateEvents=[],approvedOb=[],schedule=null,calendar=[]}={}){
 if(!validDate(from)||!validDate(to)||from>to||
  Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>31*86400000)return [];
 const byDate=new Map();
 function dayFor(date){
  if(!validDate(date)||date<from||date>to)return null;
  if(!byDate.has(date))byDate.set(date,{date,gate:[],slots:{},ob:[],invalidGate:false});
  return byDate.get(date);
 }
 for(const item of dtrEvents){
  const day=dayFor(item.schoolDate);
  if(day&&SLOTS.has(item.slot)&&localDate(item.occurredAt)===item.schoolDate)
   day.slots[item.slot]=localTime(item.occurredAt);
 }
 for(const item of gateEvents){
  const day=dayFor(item.schoolDate);
  if(!day)continue;
  const time=localTime(item.occurredAt);
  if(!time||localDate(item.occurredAt)!==item.schoolDate||
    !['TIME_IN','TIME_OUT'].includes(item.eventType)){
   day.invalidGate=true;
  }else day.gate.push({eventType:item.eventType,time});
 }
 const first=Date.parse(from+'T00:00:00+08:00'),last=Date.parse(to+'T00:00:00+08:00');
 for(const ob of approvedOb){
  const starts=Date.parse(ob.startsAt),ends=Date.parse(ob.endsAt);
  if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts)continue;
  for(let stamp=first;stamp<=last;stamp+=86400000){
   if(starts<stamp+86400000&&ends>stamp){
    const date=localDate(stamp),day=dayFor(date);
    if(day)day.ob.push(ob);
   }
  }
 }
 const calByDate=new Map();
 if(Array.isArray(calendar))for(const c of calendar){
  const day=dayFor(c.schoolDate);
  if(day)calByDate.set(day.date,true);
 }
 return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(day=>{
  let result;
  const weekday=new Date(day.date+'T12:00:00Z').getUTCDay();
  const multipleDayOb=day.ob.some(ob=>localDate(ob.startsAt)!==day.date||localDate(ob.endsAt)!==day.date);
  const blocked=reason=>({suggestions:{},review:[reason],safeToApply:false});
  if(!Array.isArray(calendar))result=blocked('CALENDAR_UNAVAILABLE');
  else if(calByDate.has(day.date))result=blocked('CALENDAR_EXCEPTION_REQUIRES_REVIEW');
  else if(!schedule?.workdays?.includes(weekday))result=blocked('SCHEDULE_UNAVAILABLE');
  else if(day.invalidGate)result=blocked('GATE_HISTORY_AMBIGUOUS');
  else if(multipleDayOb)result=blocked('OB_INTERVAL_AMBIGUOUS');
  else result=reconcileGateDay({
   movements:day.gate,existingSlots:day.slots,
   hours:weekday===6?schedule.saturdayHours:schedule.regularHours,
   approvedOb:day.ob.map(ob=>({start:localTime(ob.startsAt),end:localTime(ob.endsAt)}))
  });
  return {
   date:day.date,verifiedGateCount:day.gate.length,approvedObCount:day.ob.length,
   existingSlots:day.slots,suggestions:result.suggestions,
   review:result.review,safeToApply:false
  };
 });
}
module.exports={summarizePersonalAttendance,localDate,localTime};
