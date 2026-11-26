'use strict';
const ZONE='Asia/Manila';
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function dateInManila(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;const p=Object.fromEntries(dateFmt.formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function localTime(value){const d=new Date(value);return Number.isFinite(d.getTime())?timeFmt.format(d):null;}
function lateBy(endAt,gateAt){
 const endMs=typeof endAt==='number'?endAt:Date.parse(endAt);
 const minutes=Math.floor((Date.parse(gateAt)-endMs)/60000);
 if(!Number.isFinite(minutes)||minutes<0)return null;
 const hours=Math.floor(minutes/60),mins=minutes%60;
 return hours?hours+'h '+String(mins).padStart(2,'0')+'m':minutes+'m';
}
function buildObDtrRemarks(date,approvedOb=[],physicalGate=[],now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
 const dayStart=Date.parse(date+'T00:00:00+08:00'),dayEnd=dayStart+86400000;
 if(!Number.isFinite(dayStart))return [];
 return approvedOb.filter(ob=>{
  const start=Date.parse(ob.startsAt),end=Date.parse(ob.completionStatus==='VERIFIED'?(ob.coverageEndsAt||ob.endsAt):ob.endsAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&start<dayEnd&&end>dayStart;
 }).map(ob=>{
  const start=Date.parse(ob.startsAt),end=Date.parse(ob.endsAt);
  const sameDay=dateInManila(ob.startsAt)===date&&dateInManila(ob.endsAt)===date;
  const arrivals=physicalGate.filter(g=>g.schoolDate===date&&g.eventType==='TIME_IN'&&Date.parse(g.occurredAt)>end)
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  // A later gate arrival is a verified movement, not proof of OB completion.
  const returnEvent=arrivals[0];
  // A next-date arrival is independent attendance, not a historical logout.
  // Require a verified departure near the authorized start and no later same-day
  // arrival before suggesting a completion review. Never infer the actual end.
  const sameDayEvents=physicalGate.filter(g=>g.schoolDate===date&&dateInManila(g.occurredAt)===date)
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  const departure=sameDayEvents[sameDayEvents.length-1];
  const hasUnreturnedDeparture=sameDay&&departure?.eventType==='TIME_OUT'&&
    Math.abs(Date.parse(departure.occurredAt)-start)<=15*60000&&Number(now)>=dayEnd;
  const nextDate=dateInManila(dayEnd);
  const nextEvents=physicalGate.filter(g=>g.schoolDate===nextDate&&dateInManila(g.occurredAt)===nextDate)
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  const nextArrival=hasUnreturnedDeparture&&nextEvents[0]?.eventType==='TIME_IN'?nextEvents[0]:null;
  const noReturnReview=!returnEvent&&hasUnreturnedDeparture;
  const completionVerified=ob.completionStatus==='VERIFIED'&&Number.isFinite(Date.parse(ob.completionAt));
  const completionText=completionVerified?' · Verified OB completion '+dateInManila(ob.completionAt)+' '+localTime(ob.completionAt):'';
  return {
   type:'APPROVED_OB',requestId:ob.requestId,
   approvedStart:ob.startsAt,approvedEnd:ob.endsAt,
   purpose:ob.purpose,destination:ob.destination,
   remark:(sameDay?`Approved OB ${localTime(ob.startsAt)}–${localTime(ob.endsAt)}`:'Approved OB (spans reporting date)')+completionText,
   ...(completionVerified?{completionAt:ob.completionAt,completionStatus:'VERIFIED'}:ob.completionStatus?{completionStatus:ob.completionStatus,exception:'OB_COMPLETION_REVIEW',exceptionRemark:'OB completion '+String(ob.completionStatus).replaceAll('_',' ').toLowerCase()+'; reported completion is not an official DTR punch.'}:returnEvent?{actualGateReturn:returnEvent.occurredAt,
     exception:'RETURN_AFTER_APPROVED_END_REVIEW',
     exceptionRemark:`Gate re-entry ${localTime(returnEvent.occurredAt)} (${lateBy(end,returnEvent.occurredAt)} after OB end).`}:noReturnReview?{
     exception:'OB_NO_SAME_DAY_RETURN_REVIEW',
     exceptionRemark:nextArrival?`No same-day gate return. ${nextDate} ${localTime(nextArrival.occurredAt)} is a separate gate entry; verify OB completion for ${date}.`:'No same-day gate return recorded; verify OB completion. Do not infer a PM Out.',
     ...(nextArrival?{nextDayGateEntry:nextArrival.occurredAt}:{})
   }:{})
  };
 });
}
module.exports={buildObDtrRemarks};
