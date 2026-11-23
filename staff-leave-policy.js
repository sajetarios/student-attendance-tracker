'use strict';
// Deliberately independent of gate/OB/DTR slot interpretation.
const TYPES=Object.freeze(['VACATION','SICK','MATERNITY','PATERNITY','SPECIAL_PRIVILEGE','WELLNESS','VSC','OTHER']);
const ACCOUNTS=Object.freeze(['NONE','VSC','VL','SL']);
const DAYS=/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
function dateOk(s){if(typeof s!=='string'||!DAYS.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
function dateSpan(from,to){if(!dateOk(from)||!dateOk(to))return null;const days=Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);return days>=0&&days<=366?days+1:null;}
function parseRequest(body){
 const x=body||{},leaveType=String(x.leaveType||'').toUpperCase(),
  account=String(x.creditAccount||'NONE').toUpperCase(),
  startDate=String(x.startDate||''),endDate=String(x.endDate||''),
  reason=String(x.reason||'').trim(),details=String(x.details||'').trim(),
  commutation=x.commutation==='REQUESTED'?'REQUESTED':'NOT_REQUESTED';
 if(!TYPES.includes(leaveType)||!ACCOUNTS.includes(account)||!dateSpan(startDate,endDate)
  ||reason.length<3||reason.length>1000||details.length>1500)return null;
 if(leaveType==='VSC'&&account!=='VSC')return null;
 if(['MATERNITY','PATERNITY'].includes(leaveType)&&account!=='NONE')return null;
 return {leaveType,creditAccount:account,startDate,endDate,reason,details,commutation};
}
function positiveDays(n){const x=Number(n);return Number.isFinite(x)&&x>0&&x<=366&&Math.abs(x*1000-Math.round(x*1000))<1e-7?x:null;}
function canView(role,actorId,actorDepartment,request){
 return actorId===request.staff_user_id||role==='SCHOOL_ADMIN'||
  (role==='DEPARTMENT_HEAD'&&actorDepartment&&actorDepartment===request.department_id);
}
function nextStatus(role,hasActiveHead){
 return ['SCHOOL_ADMIN','PRINCIPAL'].includes(role)?'PENDING_EXTERNAL':
  role==='DEPARTMENT_HEAD'?'PENDING_ADMIN':hasActiveHead?'PENDING_HEAD':'PENDING_ADMIN';
}
function allowReviewer(role,actorId,actorDepartment,request,action){
 if(actorId===request.staff_user_id)return false;
 if(action==='HEAD')return role==='DEPARTMENT_HEAD'&&request.status==='PENDING_HEAD'
  &&actorDepartment===request.department_id;
 if(action==='ADMIN')return role==='SCHOOL_ADMIN'&&request.status==='PENDING_ADMIN';
 if(action==='EXTERNAL')return request.status==='PENDING_EXTERNAL'
  &&(role==='SCHOOL_ADMIN'||(role==='DEPARTMENT_HEAD'&&request.requester_role==='SCHOOL_ADMIN'));
 return false;
}
module.exports={TYPES,ACCOUNTS,dateOk,dateSpan,parseRequest,positiveDays,canView,nextStatus,allowReviewer};
