'use strict';
const {dateOk,positiveDays,dateSpan}=require('./staff-leave-policy');
const {manilaToday}=require('./staff-leave-deped-sick');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function parseRevision(body){
 const x=body||{},decision=String(x.decision||''),reference=String(x.approvalReference||'').trim(),reason=String(x.reason||'').trim(),documentId=String(x.documentId||''),approvedOn=String(x.approvedOn||''),approverName=String(x.approverName||'').trim(),approverPosition=String(x.approverPosition||'').trim();
 if(!['CANCEL','SHORTEN','AMEND'].includes(decision)||!UUID.test(documentId)||!Number.isInteger(x.revision)||x.revision<1||
  reference.length<3||reference.length>120||reason.length<3||reason.length>1000||!dateOk(approvedOn)||
  approverName.length<3||approverName.length>120||approverPosition.length<3||approverPosition.length>120||x.evidenceVerified!==true)return null;
 const endDate=decision!=='CANCEL'?String(x.endDate||''):null,days=decision!=='CANCEL'?positiveDays(x.certifiedWorkingDays):0;
 const startDate=decision==='AMEND'?String(x.startDate||''):null,leaveSession=decision==='AMEND'?String(x.leaveSession||''):null;
 if(decision!=='CANCEL'&&(!dateOk(endDate)||!days))return null;
 if(decision==='AMEND'&&(!dateSpan(startDate,endDate)||!['FULL','AM','PM'].includes(leaveSession)||(leaveSession!=='FULL'&&(startDate!==endDate||days!==0.5))))return null;
 return {decision,reference,reason,documentId,revision:x.revision,approvedOn,approverName,approverPosition,endDate,days,startDate,leaveSession};
}
const milli=n=>Math.round(Number(n)*1000);
function planRevision(row,input,ledger,today=manilaToday()){
 if(!input)return null;
 if(row.status!=='APPROVED'||row.revision!==input.revision)return null;
 const oldDays=positiveDays(row.certified_working_days),account=row.credit_account;
 if(!oldDays||!['VSC','VL','SL','NONE'].includes(account))return null;
 if(input.decision==='SHORTEN'&&((row.leave_session||'FULL')!=='FULL'||input.endDate<row.start_date||input.endDate>=row.end_date||input.days>oldDays||input.days>dateSpan(row.start_date,input.endDate)))return null;
 if(input.decision==='AMEND'){
  // A replacement of future unused leave must retain type and account; no automatic new entitlement.
  if(!['SICK','VACATION','VSC'].includes(row.leave_type)||row.start_date<=today||input.startDate<=today||input.approvedOn>today||
   input.days>oldDays||input.days>dateSpan(input.startDate,input.endDate)||
   (input.startDate===row.start_date&&input.endDate===row.end_date&&input.leaveSession===(row.leave_session||'FULL')&&input.days===oldDays))return null;
 }
 const restore=milli(oldDays)-milli(input.days);
 if(restore<0)return null;
 // Restore only a known net charge from this very request. Ambiguous legacy
 // credits or prior manual adjustments must be reviewed outside this workflow.
 if(account==='NONE'&&ledger.length)return null;
 if(account!=='NONE'){
  if(ledger.some(e=>e.credit_account!==account||!['USED','ADJUSTMENT'].includes(e.entry_kind)||
    (e.entry_kind==='USED'&&Number(e.signed_days)>=0)||(e.entry_kind==='ADJUSTMENT'&&Number(e.signed_days)<=0)))return null;
  if(ledger.filter(e=>e.entry_kind==='USED').length!==1||ledger.reduce((n,e)=>n+milli(e.signed_days),0)!==-milli(oldDays))return null;
 }
 return {newDays:input.days,restoredDays:account==='NONE'?0:restore/1000,account};
}
module.exports={parseRevision,planRevision};
