'use strict';
// Read-only, evidence-based suggestions. Never invent a clock punch from OB approval.
const SLOTS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
const mins=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'')?Number(t.slice(0,2))*60+Number(t.slice(3)):null;
function reconcileGateDay({movements=[],existingSlots={},hours={},approvedOb=[]}={}){
 const suggestions={},review=[],blockedSlots=new Set();
 let lateObReturnPending=false;
 const h=SLOTS.map(k=>mins(hours[k]));
 if(h.some(x=>x===null)||!(h[0]<h[1]&&h[1]<=h[2]&&h[2]<h[3]))
  return {suggestions,review:['SCHEDULE_UNAVAILABLE'],safeToApply:false};
 const sorted=[...movements].sort((a,b)=>String(a.time).localeCompare(String(b.time)));
 const confirmedExitGap=sorted.length===3&&sorted[0].eventType==='TIME_IN'&&
  sorted[1].eventType==='TIME_OUT'&&sorted[2].eventType==='TIME_OUT'&&
  sorted[2].confirmedMissingReturnExit===true&&Boolean(existingSlots.AM_IN&&existingSlots.AM_OUT)&&
  mins(sorted[2].time)>=h[2]&&Math.abs(mins(sorted[2].time)-h[3])<=120&&
  Math.abs(mins(sorted[2].time)-h[1])-Math.abs(mins(sorted[2].time)-h[3])>15;
 const valid=sorted.every((e,i)=>mins(e.time)!==null&&
   (e.eventType===(i%2===0?'TIME_IN':'TIME_OUT')||(confirmedExitGap&&i===2))&&
   (i===0||mins(e.time)>mins(sorted[i-1].time)));
 if(!valid)return {suggestions,review:['GATE_HISTORY_AMBIGUOUS'],safeToApply:false};
 const intervals=approvedOb.map(o=>({start:mins(o.start),end:mins(o.end)}));
 if(intervals.some(o=>o.start===null||o.end===null||o.start>=o.end))
  return {suggestions,review:['OB_INTERVAL_AMBIGUOUS'],safeToApply:false};
 for(let i=0;i<sorted.length;i++){
  const e=sorted[i],t=mins(e.time);
  // A verified return after the authorized OB interval needs an explicit review.
  // Only recognize it when an earlier verified departure aligns with that OB;
  // an isolated evening arrival must not be assumed to complete official business.
  const prior=i>0?sorted[i-1]:null;
  const lateObReturn=e.eventType==='TIME_IN'&&prior?.eventType==='TIME_OUT'&&
   intervals.some(o=>mins(prior.time)>=o.start-15&&mins(prior.time)<=o.end+15&&t>o.end+15);
  if(lateObReturn){
   lateObReturnPending=true;
   review.push('OB_RETURN_AFTER_APPROVED_END_REVIEW');continue;
  }
  // Subsequent movements do not establish whether the delayed OB was completed
  // or whether later gate departures count as official DTR time-out.
  if(lateObReturnPending){review.push('POST_OB_RETURN_MOVEMENT_REVIEW');continue;}
  if(intervals.some(o=>t>=o.start-15&&t<=o.end+15)){
   review.push('OB_BOUNDARY_GATE_MOVEMENT');continue;
  }
  // Evaluate both AM and PM boundaries for this movement type. A 12:50
  // arrival should be considered near the 13:00 PM_IN boundary, rather than
  // incorrectly treated as AM_IN simply because it happened before 13:00.
  // Suggestions remain review-only; clock proximity never proves attendance.
  const candidateSlots=e.eventType==='TIME_IN'?['AM_IN','PM_IN']:['AM_OUT','PM_OUT'];
  const choices=candidateSlots.map(slot=>({
   slot,minutesAway:Math.abs(t-mins(hours[slot]))
  })).sort((a,b)=>a.minutesAway-b.minutesAway);
  if(choices[0].minutesAway>120){review.push('OUTSIDE_SCHEDULE_WINDOW');continue;}
  // Close or equally plausible boundaries must be resolved by a person,
  // never assigned to the first alphabetical or chronological slot.
  if(choices[1].minutesAway<=120&&choices[1].minutesAway-choices[0].minutesAway<=15){
   review.push('AMBIGUOUS_SCHEDULE_SLOT');continue;
  }
  const slot=choices[0].slot;
  if(existingSlots[slot]){review.push('SLOT_ALREADY_VERIFIED');continue;}
  if(blockedSlots.has(slot)){review.push('DUPLICATE_SLOT_CANDIDATES');continue;}
  if(suggestions[slot]){
   delete suggestions[slot];blockedSlots.add(slot);
   review.push('DUPLICATE_SLOT_CANDIDATES');continue;
  }
  suggestions[slot]={time:e.time,source:'VERIFIED_GATE',requiresApproval:true};
 }
 if(intervals.length)review.push('OB_COVERAGE_REQUIRES_REVIEW');
 return {suggestions,review:[...new Set(review)],safeToApply:false};
}
module.exports={reconcileGateDay};
