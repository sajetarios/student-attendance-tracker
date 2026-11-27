'use strict';
// Draft monthly Form 48 calculation from verified staff punches.
// Missing punches are evidence gaps, never automatic approved absences.
const {obCoverageForDate,calculateObBoundaryGaps}=require('./attendance-reconciliation');
const {assessPartialLeave}=require('./attendance-partial-leave');
const SLOTS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
const isTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minuteOf=value=>isTime(value)?Number(value.slice(0,2))*60+Number(value.slice(3,5)):null;
function validHours(value){
 if(!value||typeof value!=='object')return false;
 const v=SLOTS.map(s=>minuteOf(value[s]));
 return v.every(Number.isInteger)&&v[0]<v[1]&&v[1]<=v[2]&&v[2]<v[3];
}
function clockMinutes(value){const n=minuteOf(value);return n===null?null:n;}
function implausibleSlot(slots,hours){
 // Chronology is independent of configured hours. Compare every known slot in order.
 const observed=SLOTS.map(s=>minuteOf(slots[s])).filter(n=>n!==null);
 if(observed.some((n,i)=>i>0&&n<observed[i-1]))return true;
 if(!validHours(hours))return false;
 const h=Object.fromEntries(SLOTS.map(s=>[s,minuteOf(hours[s])]));
 return SLOTS.some(slot=>{
  const at=minuteOf(slots[slot]);
  if(at===null)return false;
  if(slot==='AM_IN')return at<Math.max(0,h.AM_IN-240)||at>h.AM_OUT;
  if(slot==='AM_OUT')return at<h.AM_IN||at>h.PM_IN;
  if(slot==='PM_IN')return at<h.AM_OUT||at>h.PM_OUT;
  return at<h.PM_IN;
 });
}
function isoDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'));}
function summarizeForm48({records=[],month,today,settings=null,calendar=[],officialBusiness=[],leave=null,approvedLeaves=[],pendingSickLeaves=[],pendingOtherLeaves=[],scheduleAdjustments=[]}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Invalid report month');
 const configured=Boolean(settings);
 const workdays=configured&&Array.isArray(settings.workdays)?settings.workdays:[];
 const daysByDate=new Map((records||[]).map(r=>[r.date,r]));
 const exceptions=new Map((calendar||[]).map(x=>[x.date,x.type]));
 const reviews=configured&&settings.dayReviews&&typeof settings.dayReviews==='object'?settings.dayReviews:{};
 const calendarMonthDays=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 const timeConfigured=workdays.length>0&&
  (!workdays.some(day=>day!==6)||validHours(settings.regularHours))&&
  (!workdays.includes(6)||validHours(settings.saturdayHours));
 const summary={daysPresent:0,daysAbsent:0,excusedDays:0,pendingAbsentDays:0,
  verifiedPartialDutyDays:0,verifiedEvidenceDays:0,timeConfigured,
  partialRecordDays:0,scheduledDays:0,approvedLeaveDays:0,timeAnomalyDays:0,tardyMinutes:timeConfigured?0:null,
  undertimeMinutes:timeConfigured?0:null,tardyDays:0,undertimeDays:0,
  incompleteTimingDays:0,unresolvedDays:0,configured,hasUnreviewed:false};
 const assessments=[];
 for(let day=1;day<=calendarMonthDays;day++){
  const date=month+'-'+String(day).padStart(2,'0');
  const record=daysByDate.get(date);
  const slots=record?.slots||{};
  const verifiedCount=SLOTS.filter(s=>isTime(slots[s])).length;
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  const exception=exceptions.get(date);
  const scheduled=configured&&(exception==='OPEN'||workdays.includes(weekday))&&exception!=='CLOSED';
  const past=isoDate(today)&&date<today;
  const present=verifiedCount>0;
  const obCoverage=obCoverageForDate(date,officialBusiness||[]);
  const approvedOB=obCoverage.approved;
  const leaveDay=leave?.from&&leave?.to&&date>=leave.from&&date<=leave.to;
  const dayLeaves=(approvedLeaves||[]).filter(p=>p.from&&p.to&&date>=p.from&&date<=p.to);
  const documentedLeave=dayLeaves.length>0;
  const sickFilingPending=(pendingSickLeaves||[]).some(p=>p.from&&p.to&&date>=p.from&&date<=p.to);
  const otherFilingPending=(pendingOtherLeaves||[]).some(p=>p.from&&p.to&&date>=p.from&&date<=p.to);
  const review=reviews[date]||'PENDING';
  const authorizationConflict=approvedOB&&documentedLeave;
  let status='NOT_SCHEDULED',lateMinutes=0,earlyMinutes=0,needsReview=false;
  if(scheduled&&date<=today)summary.scheduledDays++;
  if(present&&scheduled)summary.verifiedEvidenceDays++;
  const adjustment=(scheduleAdjustments||[]).find(item=>item.from<=date&&date<=item.to&&(!item.archivedDate||date<item.archivedDate))||null;
  const hours=adjustment&&validHours(adjustment.hours)?adjustment.hours:weekday===6?settings?.saturdayHours:settings?.regularHours;
  if(dayLeaves.length&&dayLeaves.some(l=>['AM','PM'].includes(l.leaveSession))){
   const partial=assessPartialLeave({leaves:dayLeaves,slots,hours,obCoverage,scheduled,past,date,today,legacyLeave:leaveDay,review});
   if(exception==='SHORTENED_DAY'&&!adjustment){partial.needsReview=true;partial.status='PARTIAL_LEAVE_REVIEW';partial.lateMinutes=0;partial.undertimeMinutes=0;partial.presentDays=0;partial.leaveDays=0;}
   summary.daysPresent+=partial.presentDays;summary.approvedLeaveDays+=partial.leaveDays;summary.excusedDays+=partial.leaveDays;
   if(summary.tardyMinutes!==null)summary.tardyMinutes+=partial.lateMinutes;
   if(summary.undertimeMinutes!==null)summary.undertimeMinutes+=partial.undertimeMinutes;
   if(partial.lateMinutes)summary.tardyDays++;if(partial.undertimeMinutes)summary.undertimeDays++;
   if(partial.needsReview){summary.unresolvedDays++;summary.hasUnreviewed=true;summary.incompleteTimingDays++;}
   assessments.push({date,day,weekday,status:partial.status,scheduled,past,verifiedCount,verifiedSlots:SLOTS.filter(k=>isTime(slots[k])),
    lateMinutes:partial.lateMinutes,undertimeMinutes:partial.undertimeMinutes,needsReview:partial.needsReview,approvedOB:Boolean(approvedOB),
    authorizationConflict:partial.status==='OB_LEAVE_CONFLICT',leaveDay:true,approvedLeave:true,partialLeave:true,approvedLeaveDays:partial.leaveDays,
    sickLeavePending:Boolean(sickFilingPending),otherLeavePending:Boolean(otherFilingPending),calendarException:exception||null,review,temporaryMemoId:adjustment?.memoId||null,temporaryHours:adjustment?.hours||null});
   continue;
  }
  // An approved-leave day with a verified DTR punch is an unresolved conflict,
  // not an ordinary day present until an authorized attendance review resolves it.
  if(scheduled&&present&&past&&verifiedCount<4){summary.partialRecordDays++;needsReview=true;}
  if(authorizationConflict){status='OB_LEAVE_CONFLICT';needsReview=true;}
  else if(!scheduled){status=present?'UNSCHEDULED_PUNCH':'NOT_SCHEDULED';if(present)needsReview=true;}
  else if(documentedLeave&&!present&&date>today){
   // Future approved leave is scheduled, not yet a completed excused day.
   status='UPCOMING_APPROVED_LEAVE';
  }
  else if(documentedLeave&&!present){
   // Approved leave must be visible on the actual date, not only a day later.
   status='APPROVED_LEAVE';summary.excusedDays++;summary.approvedLeaveDays++;
  }
  else if(!past&&!present){
   status='NOT_DUE';
   if(sickFilingPending){
    status=date>today?'SICK_LEAVE_REQUESTED_FUTURE':'SICK_LEAVE_PENDING';
    needsReview=date===today;
   }
  }
  else if(present){status=verifiedCount===4?'VERIFIED':'INCOMPLETE_DTR';
   if(documentedLeave){status='LEAVE_PUNCH_CONFLICT';needsReview=true;}}
  else if(approvedOB){status='APPROVED_OB_REVIEW';needsReview=true;}
  else if(leaveDay){status='LEAVE_REVIEW';needsReview=true;}
  else if(sickFilingPending&&review==='ABSENT'&&past){
   // Pending application cannot overturn an administrator's prior absence decision.
   status='SICK_LEAVE_REVIEW_CONFLICT';summary.daysAbsent++;needsReview=true;
  }
  else if(sickFilingPending){status='SICK_LEAVE_PENDING';needsReview=true;}
  else if(review==='EXCUSED'&&past){status='EXCUSED';summary.excusedDays++;}
  else if(review==='ABSENT'&&past){status='CONFIRMED_ABSENT';summary.daysAbsent++;}
  else if(past){status='MISSING_REVIEW';summary.pendingAbsentDays++;needsReview=true;}
  // Pending non-sick filings are not approved leave, even on a confirmed absence.
  // Surface the pending decision without overwriting a stronger existing conflict.
  if(scheduled&&date<=today&&otherFilingPending&&!documentedLeave&&!authorizationConflict){
   if(!needsReview||status==='MISSING_REVIEW')status='LEAVE_REVIEW';
   needsReview=true;
  }
  const anomalous=scheduled&&present&&!approvedOB&&!leaveDay&&!documentedLeave&&
   exception!=='SHORTENED_DAY'&&implausibleSlot(slots,hours);
  if(anomalous){status='TIME_SLOT_REVIEW';needsReview=true;summary.timeAnomalyDays++;summary.incompleteTimingDays++;}
  if(scheduled&&present&&!anomalous&&!approvedOB&&!leaveDay&&!documentedLeave&&exception!=='SHORTENED_DAY'){
   if(validHours(hours)){
    for(const slot of ['AM_IN','PM_IN']){
     const at=clockMinutes(slots[slot]),expected=clockMinutes(hours[slot]);
     if(at!==null)lateMinutes+=Math.max(0,at-expected);
    }
    for(const slot of ['AM_OUT','PM_OUT']){
     const at=clockMinutes(slots[slot]),expected=clockMinutes(hours[slot]);
     if(at!==null)earlyMinutes+=Math.max(0,expected-at);
    }
    if(summary.tardyMinutes!==null)summary.tardyMinutes+=lateMinutes;
    if(summary.undertimeMinutes!==null)summary.undertimeMinutes+=earlyMinutes;
    if(lateMinutes)summary.tardyDays++;
    if(earlyMinutes)summary.undertimeDays++;
    if(past&&verifiedCount<4){summary.incompleteTimingDays++;needsReview=true;}
   }else{
    summary.tardyMinutes=null;summary.undertimeMinutes=null;
    if(past){summary.incompleteTimingDays++;needsReview=true;}
   }
  }else if(scheduled&&present&&past&&(approvedOB||leaveDay||documentedLeave||exception==='SHORTENED_DAY')){
   summary.incompleteTimingDays++;needsReview=true;
   // OB dates remain draft/review-only; compute only evidenced, uncovered session boundaries.
   if(approvedOB&&!leaveDay&&!documentedLeave&&exception!=='SHORTENED_DAY'){
    status='APPROVED_OB_REVIEW';
    const timing=calculateObBoundaryGaps(slots,hours,obCoverage);
    if(timing){
     lateMinutes=timing.lateMinutes;earlyMinutes=timing.undertimeMinutes;
     if(summary.tardyMinutes!==null)summary.tardyMinutes+=lateMinutes;
     if(summary.undertimeMinutes!==null)summary.undertimeMinutes+=earlyMinutes;
     if(lateMinutes)summary.tardyDays++;
     if(earlyMinutes)summary.undertimeDays++;
    }
   }
  }
  // Count only complete, plausible sessions on ordinary duty days. An incomplete
  // or conflicting day never becomes a full day of attendance from one punch.
  if(scheduled&&present&&!anomalous&&!approvedOB&&!leaveDay&&!documentedLeave&&validHours(hours)&&exception!=='SHORTENED_DAY'){
   const completeSessions=['AM','PM'].filter(s=>isTime(slots[s+'_IN'])&&isTime(slots[s+'_OUT'])).length;
   summary.daysPresent+=completeSessions/2;
   if(completeSessions===1)summary.verifiedPartialDutyDays+=0.5;
  }
  if(needsReview){summary.unresolvedDays++;summary.hasUnreviewed=true;}
  assessments.push({date,day,weekday,status,scheduled,past,verifiedCount,
   lateMinutes,undertimeMinutes:earlyMinutes,needsReview,timeAnomaly:Boolean(anomalous),approvedOB:Boolean(approvedOB),authorizationConflict:Boolean(authorizationConflict),
   leaveDay:Boolean(leaveDay||documentedLeave),approvedLeave:Boolean(documentedLeave),
   sickLeavePending:Boolean(sickFilingPending),otherLeavePending:Boolean(otherFilingPending),calendarException:exception||null,review,
   temporaryMemoId:adjustment?.memoId||null,temporaryHours:adjustment?.hours||null});
 }
 if(!configured){summary.tardyMinutes=null;summary.undertimeMinutes=null;}
 // A monthly report without valid prescribed hours cannot be signature-ready.
 if(!timeConfigured)summary.hasUnreviewed=true;
 return {summary,assessments};
}
module.exports={SLOTS,isTime,validHours,summarizeForm48};
