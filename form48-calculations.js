'use strict';
// Draft monthly Form 48 calculation from verified staff punches.
// Missing punches are evidence gaps, never automatic approved absences.
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
function summarizeForm48({records=[],month,today,settings=null,calendar=[],officialBusiness=[],leave=null,approvedLeaves=[]}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Invalid report month');
 const configured=Boolean(settings);
 const workdays=configured&&Array.isArray(settings.workdays)?settings.workdays:[];
 const daysByDate=new Map((records||[]).map(r=>[r.date,r]));
 const exceptions=new Map((calendar||[]).map(x=>[x.date,x.type]));
 const reviews=configured&&settings.dayReviews&&typeof settings.dayReviews==='object'?settings.dayReviews:{};
 const calendarMonthDays=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 const timeConfigured=configured&&validHours(settings.regularHours)&&(!workdays.includes(6)||validHours(settings.saturdayHours));
 const summary={daysPresent:0,daysAbsent:0,excusedDays:0,pendingAbsentDays:0,
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
  const approvedOB=(officialBusiness||[]).some(b=>date>=b.from&&date<=b.to);
  const leaveDay=leave?.from&&leave?.to&&date>=leave.from&&date<=leave.to;
  const documentedLeave=(approvedLeaves||[]).some(p=>p.from&&p.to&&date>=p.from&&date<=p.to);
  const review=reviews[date]||'PENDING';
  let status='NOT_SCHEDULED',lateMinutes=0,earlyMinutes=0,needsReview=false;
  if(scheduled&&date<=today)summary.scheduledDays++;
  // An approved-leave day with a verified DTR punch is an unresolved conflict,
  // not an ordinary day present until an authorized attendance review resolves it.
  if(present&&scheduled&&!documentedLeave){summary.daysPresent++;}
  if(scheduled&&present&&past&&verifiedCount<4){summary.partialRecordDays++;needsReview=true;}
  if(!scheduled){status=present?'UNSCHEDULED_PUNCH':'NOT_SCHEDULED';}
  else if(documentedLeave&&!present&&date>today){
   // Future approved leave is scheduled, not yet a completed excused day.
   status='UPCOMING_APPROVED_LEAVE';
  }
  else if(documentedLeave&&!present){
   // Approved leave must be visible on the actual date, not only a day later.
   status='APPROVED_LEAVE';summary.excusedDays++;summary.approvedLeaveDays++;
  }
  else if(!past&&!present){status='NOT_DUE';}
  else if(present){status=verifiedCount===4?'VERIFIED':'INCOMPLETE_DTR';
   if(documentedLeave){status='LEAVE_PUNCH_CONFLICT';needsReview=true;}}
  else if(approvedOB){status='APPROVED_OB_REVIEW';needsReview=true;}
  else if(leaveDay){status='LEAVE_REVIEW';needsReview=true;}
  else if(review==='EXCUSED'&&past){status='EXCUSED';summary.excusedDays++;}
  else if(review==='ABSENT'&&past){status='CONFIRMED_ABSENT';summary.daysAbsent++;}
  else if(past){status='MISSING_REVIEW';summary.pendingAbsentDays++;needsReview=true;}
  const hours=weekday===6?settings?.saturdayHours:settings?.regularHours;
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
  }
  if(needsReview){summary.unresolvedDays++;summary.hasUnreviewed=true;}
  assessments.push({date,day,weekday,status,scheduled,past,verifiedCount,
   lateMinutes,undertimeMinutes:earlyMinutes,needsReview,timeAnomaly:Boolean(anomalous),approvedOB:Boolean(approvedOB),
   leaveDay:Boolean(leaveDay||documentedLeave),approvedLeave:Boolean(documentedLeave),calendarException:exception||null,review});
 }
 if(!configured){summary.tardyMinutes=null;summary.undertimeMinutes=null;}
 return {summary,assessments};
}
module.exports={SLOTS,isTime,validHours,summarizeForm48};
