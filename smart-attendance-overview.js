'use strict';
// School-scoped, read-only exception triage. No new punches, absence flags or OB approvals.
const {effectiveStaffSchedule}=require('./staff-attendance-schedule');
const {reconcileGateDay}=require('./gate-dtr-reconciliation');
const slots=new Set(['AM_IN','AM_OUT','PM_IN','PM_OUT']);
const needsHumanReview=new Set([
 'GATE_HISTORY_AMBIGUOUS','OB_INTERVAL_AMBIGUOUS','OB_RETURN_AFTER_APPROVED_END_REVIEW',
 'POST_OB_RETURN_MOVEMENT_REVIEW','DUPLICATE_SLOT_CANDIDATES',
 'AMBIGUOUS_SCHEDULE_SLOT','OUTSIDE_SCHEDULE_WINDOW',
 'CALENDAR_EXCEPTION_REQUIRES_REVIEW'
]);
function buildSmartOverview({date,staff=[],schedules=[],defaults=null,gate=[],dtr=[],ob=[],calendarExceptions=[]}={}){
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();
 const scheduleMap=new Map(schedules.map(x=>[String(x.staffUserId),x]));
 const collect=rows=>{
  const map=new Map();for(const r of rows){
   const id=String(r.staffUserId);if(!map.has(id))map.set(id,[]);
   map.get(id).push(r);
  }return map;
 };
 const gates=collect(gate),dtrs=collect(dtr),obs=collect(ob);
 let verifiedGateEvents=0,scannedStaff=0,officialDtrStaff=0;
 const items=[];const health={review:0,pending:0,info:0};
 const scheduleNotSet=new Set();
 for(const person of staff){
  const id=String(person.userId),gateRows=gates.get(id)||[],dtrRows=dtrs.get(id)||[],obRows=obs.get(id)||[];
  if(!gateRows.length&&!dtrRows.length&&!obRows.length)continue;
  verifiedGateEvents+=gateRows.length;
  if(gateRows.length)scannedStaff++;
  const verified=Object.fromEntries(dtrRows.filter(x=>slots.has(x.slot)).map(x=>[x.slot,x.time]));
  const count=Object.keys(verified).length;
  if(count)officialDtrStaff++;
  const effective=effectiveStaffSchedule(scheduleMap.get(id)||null,defaults);
  const schedule=effective.schedule;
  let result={review:[],suggestions:{},safeToApply:false};
  if(calendarExceptions.length)result.review=['CALENDAR_EXCEPTION_REQUIRES_REVIEW'];
  else if(!schedule){
   result.review=['SCHEDULE_UNAVAILABLE'];
   scheduleNotSet.add(id);
  }else if(!schedule.workdays.includes(weekday))result.review=['NOT_SCHEDULED_WORKDAY'];
  else if(obRows.some(x=>x.crossDay))result.review=['OB_INTERVAL_AMBIGUOUS'];
  else result=reconcileGateDay({movements:gateRows.map(x=>({eventType:x.eventType,time:x.time,confirmedMissingReturnExit:x.confirmedMissingReturnExit})),
   existingSlots:verified,hours:weekday===6?schedule.saturdayHours:schedule.regularHours,
   approvedOb:obRows.map(x=>({start:x.start,end:x.end}))});
  const reasons=result.review||[];
  // An off-day scan does not prove a missed attendance duty or warrant an
  // automatic DTR entry. It remains visible for authorized special-duty review.
  let status='ok',message='Verified attendance evidence is available.';
  if(reasons.includes('SCHEDULE_UNAVAILABLE')){
   status='info';message='Working hours are not set. Set school hours once to enable matching.';
  }else if(reasons.includes('NOT_SCHEDULED_WORKDAY')){
   status='info';message='Gate activity on a day outside this employee’s regular work schedule.';
  }else if(reasons.some(x=>needsHumanReview.has(x))){
   status='review';message='Unusual or conflicting gate / OB movements need checking.';
  }else if(gateRows.length&&count<4){
   status='pending';message='Gate scans were saved, but some official DTR times are not recorded.';
  }else if(obRows.length){
   status='pending';message='Approved OB is recorded; verify the official DTR separately.';
  }
  if(status==='ok')continue;
  health[status]++;
  items.push({staffUserId:id,name:String(person.displayName||'Staff member'),role:person.role,
   status,message,gateCount:gateRows.length,dtrCount:count,approvedObCount:obRows.length,
   review:reasons,suggestions:Object.keys(result.suggestions||{}).length});
 }
 const order={review:0,pending:1,info:2};
 items.sort((a,b)=>order[a.status]-order[b.status]||a.name.localeCompare(b.name));
 return {date,scannedStaff,verifiedGateEvents,officialDtrStaff,
  reviewCount:health.review,pendingCount:health.pending,infoCount:health.info,
  schoolHoursConfigured:Boolean(effectiveStaffSchedule(null,defaults).schedule),
  items,notEvaluated:'No scan or DTR entry is not treated as an absence.',
  safeToApply:false};
}
module.exports={buildSmartOverview};
