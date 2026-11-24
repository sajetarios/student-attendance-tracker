'use strict';
// Never infer classroom presence from a school gate scan or an unfinalized register.
// All decisions below are read-only interpretations of existing authoritative records.
function resolveSubjectStatus(row,{today,nowMinutes}={}){
 const manual=String(row.manualStatus||'').toUpperCase();
 const qr=String(row.qrStatus||'').toUpperCase();
 const finalized=row.finalized===true;
 const cancelled=Boolean(row.closed)||row.adjustmentType==='CANCEL';
 const date=String(row.schoolDate||today||'');
 const end=String(row.endTime||'').slice(0,5);
 const endMinutes=/^\d{2}:\d{2}$/.test(end)?Number(end.slice(0,2))*60+Number(end.slice(3,5)):0;
 if(finalized){
   if(qr&&['ABSENT','EXCUSED'].includes(manual))return 'REVIEW';
   if(manual==='LATE'||qr==='LATE')return 'LATE';
   if(qr==='PRESENT'||manual==='PRESENT')return 'PRESENT';
   if(manual==='ABSENT'||manual==='EXCUSED')return manual;
   return 'PENDING';
 }
 if(cancelled)return 'CANCELLED';
 if(!date||!today||date>today)return 'UPCOMING';
 if(date<today)return 'PENDING';
 if(Number.isFinite(nowMinutes)&&endMinutes>nowMinutes)return 'IN_PROGRESS';
 return 'PENDING';
}
module.exports={resolveSubjectStatus};
