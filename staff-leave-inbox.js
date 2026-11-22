'use strict';
const {allowReviewer}=require('./staff-leave-policy');
const FILTERS=Object.freeze(['ACTION','ALL','PENDING','RECOMMENDATION','SCHOOL_REVIEW','EXTERNAL','APPROVED','DISAPPROVED','CANCELLED']);
const STATUS_LABELS=Object.freeze({
 PENDING_HEAD:'For Department Recommendation',
 PENDING_ADMIN:'For School Review',
 PENDING_EXTERNAL:'Awaiting Official Approval',
 APPROVED:'Approved',
 REJECTED:'Disapproved',
 CANCELLED:'Cancelled'
});
function canUseInbox(role){return role==='SCHOOL_ADMIN'||role==='DEPARTMENT_HEAD';}
function scopeFor(auth){
 const args=[auth.schoolId];
 if(auth.role==='DEPARTMENT_HEAD'){
  args.push(auth.departmentId||null);
  return {where:"r.school_id=$1 AND (r.department_id=$2 OR (u.role='SCHOOL_ADMIN' AND r.status='PENDING_EXTERNAL'))",args};
 }
 if(auth.role==='SCHOOL_ADMIN')return {where:'r.school_id=$1',args};
 throw Error('Leave approval inbox is only available to authorized reviewers.');
}
function actionExpression(auth,args){
 args.push(auth.userId);
 const actorIndex=args.length;
 if(auth.role==='SCHOOL_ADMIN')
  return "r.staff_user_id<>$"+actorIndex+" AND r.status IN ('PENDING_ADMIN','PENDING_EXTERNAL')";
 args.push(auth.departmentId||null);
 const deptIndex=args.length;
 return "r.staff_user_id<>$"+actorIndex+
  " AND ((r.status='PENDING_HEAD' AND r.department_id=$"+deptIndex+
  ") OR (r.status='PENDING_EXTERNAL' AND u.role='SCHOOL_ADMIN'))";
}
function publicInboxRecord(r,auth){
 const own=String(r.staff_user_id)===String(auth.userId);
 const actions={
  recommend:allowReviewer(auth.role,auth.userId,auth.departmentId,r,'HEAD'),
  schoolReview:allowReviewer(auth.role,auth.userId,auth.departmentId,r,'ADMIN'),
  recordOfficialDecision:allowReviewer(auth.role,auth.userId,auth.departmentId,r,'EXTERNAL')
 };
 return {
  requestId:r.request_id,
  staffUserId:r.staff_user_id,
  staffName:r.staff_name,
  departmentName:r.department_name||'',
  staffRole:r.requester_role,
  startDate:r.start_date,
  endDate:r.end_date,
  leaveType:own||auth.role==='SCHOOL_ADMIN'?r.leave_type:null,
  creditAccount:own||auth.role==='SCHOOL_ADMIN'?r.credit_account:null,
  status:r.status,
  statusLabel:STATUS_LABELS[r.status]||'Under review',
  submittedAt:r.submitted_at,
  headReviewedAt:r.head_decided_at||null,
  schoolReviewedAt:r.admin_reviewed_at||null,
  officialDecisionAt:r.external_approved_on||null,
  officialReference:own||auth.role==='SCHOOL_ADMIN'?r.external_reference||null:null,
  own,actions
 };
}
const statusMessage=status=>({
 PENDING_HEAD:'Submitted for department recommendation.',
 PENDING_ADMIN:'Forwarded for school review.',
 PENDING_EXTERNAL:'Awaiting the authorized official decision; not yet approved.',
 APPROVED:'Official approval was verified and entered into the leave record.',
 REJECTED:'An official disapproval was recorded.',
 CANCELLED:'The application was cancelled.'
}[status]||'Your leave application was updated.');
/**
 * Notification entries share the same DB transaction as the leave transition.
 * Notifications contain no illness, medical reason, leave subtype, salary, or attachment data.
 * They do not give the named recipient approval authority.
 */
async function notifyLeaveTransition(client,{schoolId,requestId,staffUserId,departmentId,requesterRole,status}){
 if(!STATUS_LABELS[status])return;
 const baseKey='leave:'+requestId+':'+status;
 const url='/portal.html#leaveManagement';
 const title=status==='PENDING_HEAD'?'Leave request submitted':
  status==='PENDING_ADMIN'?'Leave request awaiting school review':
  status==='PENDING_EXTERNAL'?'Leave request awaiting official decision':
  status==='APPROVED'?'Leave request approved':
  status==='REJECTED'?'Leave request disapproved':'Leave request updated';
 await client.query(
  "SELECT attendigo_notify($1,'SCHOOL_USER',$2,$3,'REQUEST',$4,$5,'Leave',$6,$7,$8,TRUE)",
  [schoolId,staffUserId,baseKey+':requester',title,statusMessage(status),requestId,status,url]
 );
 if(!status.startsWith('PENDING_'))return;
 let filter;
 if(status==='PENDING_HEAD'){
  filter="u.role='DEPARTMENT_HEAD' AND u.department_id=$9";
 }else if(status==='PENDING_ADMIN'){
  filter="u.role='SCHOOL_ADMIN'";
 }else if(requesterRole==='SCHOOL_ADMIN'){
  // An administrator cannot verify their own external decision.
  // Department Heads may record the documentary decision (not sign it).
  filter="u.role='DEPARTMENT_HEAD'";
 }else{
  filter="u.role='SCHOOL_ADMIN'";
 }
 const reviewTitle=status==='PENDING_HEAD'?'Leave recommendation requested':
  status==='PENDING_ADMIN'?'Leave school review requested':
  'Official leave decision requires documentation';
 await client.query(
  "SELECT attendigo_notify($1,'SCHOOL_USER',u.user_id,$2,'APPROVAL',$3,$4,'Leave',$5,$6,$7,TRUE) "+
  "FROM school_users u WHERE u.school_id=$1 AND u.active=TRUE AND u.user_id<>$8 AND "+filter,
  status==='PENDING_HEAD'
   ?[schoolId,baseKey+':reviewer',reviewTitle,'A school leave application needs review in your authorized scope.',requestId,status,url,staffUserId,departmentId]
   :[schoolId,baseKey+':reviewer',reviewTitle,'A school leave application needs review in your authorized scope.',requestId,status,url,staffUserId]
 );
}
module.exports={FILTERS,STATUS_LABELS,canUseInbox,scopeFor,actionExpression,publicInboxRecord,notifyLeaveTransition};
