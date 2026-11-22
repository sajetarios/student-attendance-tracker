'use strict';
// DepEd DO 013 s.2024, Section VI.C; CSC Form 6 (Revised 2020),
// CSC Omnibus Rules on Leave, Section 53. Pure, testable leave decisions.
const SCHEMES=Object.freeze(['TEACHING_VSC','REGULAR_VL_SL']);
const ACCOUNTS=Object.freeze({TEACHING_VSC:'VSC',REGULAR_VL_SL:'SL'});
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const manilaToday=()=>{
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=k=>p.find(x=>x.type===k)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
};
function sickFilingBasis(leaveType,startDate,endDate,today=manilaToday()){
 if(leaveType!=='SICK')return 'STANDARD';
 if(!DATE.test(today)||!DATE.test(startDate)||!DATE.test(endDate))return 'STANDARD';
 if(startDate>today)return 'ADVANCE';
 if(endDate<today)return 'POST_RETURN';
 return 'DURING_ABSENCE';
}
function sickAccountForScheme(scheme){
 return ACCOUNTS[scheme]||null;
}
function requiredSickEvidence(leaveType,filingBasis,startDate,endDate){
 if(leaveType!=='SICK')return false;
 const from=Date.parse(String(startDate)+'T00:00:00Z');
 const to=Date.parse(String(endDate)+'T00:00:00Z');
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)return true;
 const consecutiveDays=Math.round((to-from)/86400000)+1;
 return consecutiveDays>5||filingBasis==='ADVANCE';
}
module.exports={SCHEMES,ACCOUNTS,manilaToday,sickFilingBasis,sickAccountForScheme,requiredSickEvidence};
