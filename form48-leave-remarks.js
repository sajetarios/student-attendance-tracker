'use strict';
// Supplemental Form 48 leave annotations. Never overwrite a real DTR time entry.
const DATE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const TYPES={VACATION:'VL',SICK:'SL',MATERNITY:'Maternity Leave',
 PATERNITY:'Paternity Leave',OTHER:'Leave'};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dateLabel(from,to){
 const month=MONTHS[Number(from.slice(5,7))-1];
 const first=Number(from.slice(8)),last=Number(to.slice(8));
 return month+' '+first+(from!==to?'–'+last:'');
}
function buildForm48LeaveRemarks(month,leaves=[],assessments=[]){
 if(!MONTH.test(month)||!Array.isArray(leaves))return [];
 const [y,m]=month.split('-').map(Number);
 const beginning=month+'-01';
 const end=month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');
 const evidence=new Map((Array.isArray(assessments)?assessments:[])
  .filter(a=>a&&typeof a.date==='string').map(a=>[a.date,a]));
 return leaves.filter(row=>row&&DATE.test(row.from)&&DATE.test(row.to)&&
   row.from<=row.to&&row.from<=end&&row.to>=beginning)
  .map(row=>{
   const from=row.from<beginning?beginning:row.from;
   const to=row.to>end?end:row.to;
   const type=TYPES[row.leaveType]||'Leave';
   const approvalReference=String(row.approvalReference||'').trim();
   const label=dateLabel(from,to);
   const text=label+' — Approved '+type+
    (approvalReference?' (Ref. '+approvalReference+')':'')+'.';
   const conflicts=Array.from(evidence.values()).filter(a=>
    a.date>=from&&a.date<=to&&Number(a.verifiedCount)>0).map(a=>a.date);
   return {from,to,leaveType:row.leaveType||'OTHER',
    approvalReference,text,conflictDates:conflicts};
  }).sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
}
module.exports={buildForm48LeaveRemarks};
