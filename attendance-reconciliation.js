'use strict';
// Read-only Form 48 evidence evaluation. All intervals are half-open [start,end).
// Never creates punches, grants OB, resolves an exception or changes leave credits.
const DAY=86400000, MINUTE=60000;
function instant(value){
 if(value instanceof Date)return value.getTime();
 if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return NaN;
 return Date.parse(value);
}
function obCoverageForDate(date,requests=[]){
 const base=Date.parse(date+'T00:00:00+08:00');
 if(!Number.isFinite(base))return {approved:false,precise:false,intervals:[]};
 const intervals=[];let legacy=false;
 for(const r of requests){
  const start=instant(r.startsAt),authorizedEnd=instant(r.endsAt);
  const completed=instant(r.completionAt);
  // Retain existing approved coverage policy, including officially verified extensions.
  // A pending or rejected completion claim never changes the interval.
  const end=r.completionStatus==='VERIFIED'&&Number.isFinite(completed)
   ?Math.max(authorizedEnd,completed):authorizedEnd;
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){
   if(start<base+DAY&&end>base)intervals.push([Math.max(0,(start-base)/MINUTE),Math.min(1440,(end-base)/MINUTE)]);
  }else if(r.from&&r.to&&date>=r.from&&date<=r.to)legacy=true;
 }
 intervals.sort((a,b)=>a[0]-b[0]);
 const union=[];
 for(const i of intervals){
  const last=union[union.length-1];
  if(last&&i[0]<=last[1])last[1]=Math.max(last[1],i[1]);
  else union.push([...i]);
 }
 return {approved:legacy||union.length>0,precise:!legacy,intervals:union};
}
function uncovered(start,end,intervals){
 if(end<=start)return 0;
 let remaining=end-start;
 for(const [a,b] of intervals)remaining-=Math.max(0,Math.min(end,b)-Math.max(start,a));
 // Minute-resolution DTR: floor the uncovered result, never round up a penalty.
 return Math.max(0,Math.floor(remaining+1e-8));
}
function clock(value){
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
 return Number(value.slice(0,2))*60+Number(value.slice(3));
}
function calculateObBoundaryGaps(slots,hours,coverage){
 if(!coverage?.approved||!coverage.precise)return null;
 const h=['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>clock(hours?.[k]));
 if(h.some(x=>x===null)||!(h[0]<h[1]&&h[1]<=h[2]&&h[2]<h[3]))return null;
 const a=['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>clock(slots?.[k]));
 // Only a plausible pair of verified session boundaries supports a timing penalty.
 // Never infer an absent session or count an OB-related movement as a clock punch.
 for(let i=0;i<4;i+=2){
  if(a[i]!==null&&a[i+1]!==null&&a[i]>a[i+1])return null;
 }
 let lateMinutes=0,undertimeMinutes=0,evaluatedSessions=0;
 for(let i=0;i<4;i+=2){
  const [start,end]=h.slice(i,i+2),[arrival,departure]=a.slice(i,i+2);
  if(arrival===null||departure===null||arrival>end||departure<start)continue;
  evaluatedSessions++;
  lateMinutes+=uncovered(start,Math.min(end,arrival),coverage.intervals);
  undertimeMinutes+=uncovered(Math.max(start,departure),end,coverage.intervals);
 }
 return {lateMinutes,undertimeMinutes,evaluatedSessions};
}
module.exports={obCoverageForDate,calculateObBoundaryGaps};
