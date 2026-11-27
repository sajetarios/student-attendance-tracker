'use strict';
function minute(value){return typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;}
function assessPartialLeave({leaves,slots,hours,obCoverage,scheduled,past,date,today,legacyLeave,review}){
 const sessions=new Set(),verifiedSlots=Object.keys(slots).filter(k=>minute(slots[k])!==null);
 const result={status:'PARTIAL_LEAVE_REVIEW',needsReview:false,lateMinutes:0,undertimeMinutes:0,
  leaveDays:0,presentDays:0,conflict:false};
 const ordered=['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>minute(hours?.[k]));
 if(!scheduled||legacyLeave||ordered.some(n=>n===null)||!(ordered[0]<ordered[1]&&ordered[1]<=ordered[2]&&ordered[2]<ordered[3])||
  review==='ABSENT'||review==='EXCUSED'){
  result.needsReview=true;return result;
 }
 for(const l of leaves){
  const session=l.leaveSession,from=minute(l.sessionStart),to=minute(l.sessionEnd);
  if(!['AM','PM'].includes(session)||l.from!==l.to||sessions.has(session)||from===null||to===null||
    from!==minute(hours[session+'_IN'])||to!==minute(hours[session+'_OUT'])){
   result.needsReview=true;return result;
  }
  sessions.add(session);
  if(obCoverage.approved&&(!obCoverage.precise||obCoverage.intervals.some(([a,b])=>a<to&&b>from))){
   return {...result,status:'OB_LEAVE_CONFLICT',needsReview:true,conflict:true};
  }
  if(verifiedSlots.some(k=>k.startsWith(session+'_')))return {...result,status:'LEAVE_PUNCH_CONFLICT',needsReview:true,conflict:true};
 }
 if(date>today)return {...result,status:'UPCOMING_APPROVED_LEAVE'};
 result.leaveDays=sessions.size/2;
 for(const session of ['AM','PM']){
  if(sessions.has(session))continue;
  const start=minute(hours[session+'_IN']),end=minute(hours[session+'_OUT']);
  const arrival=minute(slots[session+'_IN']),departure=minute(slots[session+'_OUT']);
  if(arrival===null||departure===null||arrival>departure||arrival>end||departure<start){
   if(past||verifiedSlots.length)result.needsReview=true;
   continue;
  }
  // OB on the non-leave session remains a separate review; no fabricated punches.
  const gaps=(a,b)=>Math.max(0,Math.floor(Math.max(0,b-a)-obCoverage.intervals.reduce((n,[x,y])=>n+Math.max(0,Math.min(b,y)-Math.max(a,x)),0)+1e-8));
  result.lateMinutes+=gaps(start,Math.min(end,arrival));
  result.undertimeMinutes+=gaps(Math.max(start,departure),end);
  result.presentDays+=0.5;
 }
 if(obCoverage.approved)result.needsReview=true;
 if(!result.needsReview)result.status=result.leaveDays===1?'APPROVED_LEAVE':(past||result.presentDays?'PARTIAL_APPROVED_LEAVE':'PARTIAL_LEAVE_IN_PROGRESS');
 return result;
}
module.exports={assessPartialLeave};
