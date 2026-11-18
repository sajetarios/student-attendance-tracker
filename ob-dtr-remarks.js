'use strict';
const ZONE='Asia/Manila';
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function dateInManila(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;const p=Object.fromEntries(dateFmt.formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function localTime(value){const d=new Date(value);return Number.isFinite(d.getTime())?timeFmt.format(d):null;}
function buildObDtrRemarks(date,approvedOb=[],physicalGate=[]){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
 const dayStart=Date.parse(date+'T00:00:00+08:00'),dayEnd=dayStart+86400000;
 if(!Number.isFinite(dayStart))return [];
 return approvedOb.filter(ob=>{
  const start=Date.parse(ob.startsAt),end=Date.parse(ob.endsAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&start<dayEnd&&end>dayStart;
 }).map(ob=>{
  const start=Date.parse(ob.startsAt),end=Date.parse(ob.endsAt);
  const sameDay=dateInManila(ob.startsAt)===date&&dateInManila(ob.endsAt)===date;
  const arrivals=physicalGate.filter(g=>g.schoolDate===date&&g.eventType==='TIME_IN'&&Date.parse(g.occurredAt)>end)
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  // A later gate arrival is a verified movement, not proof of OB completion.
  const returnEvent=arrivals[0];
  return {
   type:'APPROVED_OB',requestId:ob.requestId,
   approvedStart:ob.startsAt,approvedEnd:ob.endsAt,
   purpose:ob.purpose,destination:ob.destination,
   remark:sameDay?`Approved OB ${localTime(ob.startsAt)}–${localTime(ob.endsAt)}`:'Approved OB (spans reporting date)',
   ...(returnEvent?{actualGateReturn:returnEvent.occurredAt,
     exception:'RETURN_AFTER_APPROVED_END_REVIEW',
     exceptionRemark:`Gate return at ${localTime(returnEvent.occurredAt)} after approved OB end; completion time and travel require review. No overtime or undertime inferred.`}:{})
  };
 });
}
module.exports={buildObDtrRemarks};
