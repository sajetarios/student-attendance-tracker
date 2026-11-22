'use strict';
// Fictional, in-memory end-to-end dress rehearsal of the actual Express route
// handlers and Form 48 calculation modules. Nothing reaches a live database.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {registerStaffLeaveRoutes}=require('../staff-leave-routes');
const {getStaffLeaveStatus,gateVisibleLeave,requiresDtrReview}=require('../staff-approved-leave-status');
const {autoRecordVerifiedGateDtr}=require('../staff-gate-dtr-auto');
const {summarizeForm48}=require('../form48-calculations');
const {buildForm48LeaveRemarks}=require('../form48-leave-remarks');
const {decideNextGateEvent}=require('../gate-event-decision');
const gateBoundary=require('../gate-attendance-boundary');

const school='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const department='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const teacher='11111111-1111-4111-8111-111111111111';
const head='22222222-2222-4222-8222-222222222222';
const admin='33333333-3333-4333-8333-333333333333';
const keeper='44444444-4444-4444-8444-444444444444';
const badge='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventKey='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const form48Settings={workdays:[1,2,3,4,5],
 regularHours:{AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'},
 saturdayHours:{},dayReviews:{}};
const requestBody={leaveType:'SICK',creditAccount:'VSC',startDate:'2026-11-23',
 endDate:'2026-11-24',reason:'Fictional medical leave for workflow testing',
 details:'Simulation only — no actual illness or official leave',commutation:'NOT_REQUESTED'};

function fixture(){
 const state={request:null,credit:5,appliedLeaves:[],audits:[],notifications:[],
  gate:[],dtr:[],signedApproval:false,scheme:'TEACHING_VSC',commits:0,rollbacks:0,queryLog:[]};
 const actors={
  [teacher]:{role:'TEACHER',department_id:department,display_name:'Simulated Teacher'},
  [head]:{role:'DEPARTMENT_HEAD',department_id:department,display_name:'Simulated Department Head'},
  [admin]:{role:'SCHOOL_ADMIN',department_id:null,display_name:'Simulated School Administrator'},
  [keeper]:{role:'GATE_KEEPER',department_id:null,display_name:'Simulated Gatekeeper'}
 };
 const rows=items=>({rows:items,rowCount:items.length});
 const client={
  release(){},
  async query(sql,args=[]){
   const s=String(sql);
   state.queryLog.push(s.slice(0,350));
   if(s==='BEGIN'||s.startsWith('SAVEPOINT')||s.startsWith('RELEASE SAVEPOINT'))return rows([]);
   if(s==='COMMIT'){state.commits++;return rows([])}
   if(s.startsWith('ROLLBACK')){state.rollbacks++;return rows([])}
   if(s.includes('pg_advisory_xact_lock'))return rows([]);
   if(s.includes('attendigo_notify')){state.notifications.push(args);return rows([])}
   if(s.startsWith('SELECT department_id,role,active FROM school_users')){
    const u=actors[args[1]];return rows(u?[{department_id:u.department_id,role:u.role,active:true}]:[]);
   }
   if(s.includes("role='DEPARTMENT_HEAD'")&&s.includes('SELECT 1 FROM school_users'))
    return rows([{exists:1}]);
   if(s.includes('SELECT request_id FROM staff_leave_requests'))
    return rows(state.request&&state.request.status!=='REJECTED'?[{request_id:state.request.request_id}]:[]);
   if(s.includes('SELECT leave_id FROM staff_form48_approved_leaves'))
    return rows(state.appliedLeaves.map(l=>({leave_id:l.leave_id})));
   if(s.includes('FROM staff_leave_requests r JOIN school_users u')){
    if(!state.request||state.request.request_id!==args[1])return rows([]);
    const r=state.request;
    return rows([{...r,requester_role:'TEACHER',staff_name:'Simulated Teacher',
      staff_position:'Teacher I',department_name:'Science',school_name:'Fictional Pilot School'}]);
   }
   if(s.startsWith('INSERT INTO staff_leave_requests')){
    const names=['request_id','school_id','staff_user_id','department_id','leave_type',
     'credit_account','start_date','end_date','reason','details','commutation','status','filing_basis'];
    state.request=Object.fromEntries(names.map((key,i)=>[key,args[i]]));
    return rows([]);
   }
   if(s.startsWith('UPDATE staff_leave_requests SET status=$3')){
    state.request.status=args[2];return rows([]);
   }
   if(s.startsWith("UPDATE staff_leave_requests SET status='APPROVED'")){
    state.request.status='APPROVED';state.request.certified_working_days=args[2];
    state.request.external_reference=args[3];
    state.request.external_approver=args[4];state.request.external_approver_position=args[5];
    state.request.external_approved_on=args[6];state.request.credit_account=args[9];
    return rows([]);
   }
   if(s.includes("document_kind='APPROVAL'"))
    return rows(state.signedApproval?[{hasDocument:1}]:[]);
   if(s.includes('SELECT COALESCE(SUM(signed_days),0)::numeric AS days'))
    return rows([{days:state.credit}]);
   if(s.startsWith('INSERT INTO staff_leave_credit_entries')){
    assert.match(s,/\'USED\'/);
    state.credit+=Number(args[3]);return rows([]);
   }
   if(s.startsWith('INSERT INTO staff_form48_approved_leaves')){
    const names=['leave_id','school_id','staff_user_id','leave_type','start_date',
     'end_date','approval_reference','recorded_by_user_id','credit_account'];
    state.appliedLeaves.push(Object.fromEntries(names.map((key,i)=>[key,args[i]])));
    return rows([]);
   }
   if(s.includes("FROM staff_form48_approved_leaves")&&s.trimStart().startsWith("SELECT 1"))
    return rows(state.appliedLeaves.length?[{exists:1}]:[]);
   if(s.startsWith('INSERT INTO staff_attendance_audit')){
    state.audits.push({action:args[2],details:args[5]});return rows([]);
   }
   if(s.includes("FROM generate_series("))return rows([{estimated:2}]);
   if(s.includes('FROM staff_leave_credit_schemes'))return rows([{leaveScheme:state.scheme}]);
   if(s.includes("FROM staff_leave_credit_entries")&&s.includes('AS balance'))
    return rows([{credit_account:'VSC',balance:String(state.credit)}]);
   // SQL behind leave profile and Gatekeeper badge, date set by this scenario.
   if(s.includes('LEFT JOIN LATERAL')&&s.includes('FROM school_users s')){
    const l=state.appliedLeaves[0];
    return rows([{schoolDate:'2026-11-24',startDate:l?.start_date||null,
      endDate:l?.end_date||null,leaveType:l?.leave_type||null,
      approvalReference:l?.approval_reference||null,
      legacyStatus:'ACTIVE',legacyStart:null,legacyEnd:null}]);
   }
   // Auto DTR projection reads actual approved leave before trying to insert.
   if(s.includes('FROM staff_form48_monthly_reviews'))return rows([]);
   if(s.includes('FROM staff_form48_employee_schedules'))return rows([]);
   if(s.includes('FROM staff_form48_school_defaults'))return rows([{
    workdays:form48Settings.workdays,regularHours:form48Settings.regularHours,
    saturdayHours:form48Settings.saturdayHours}]);
   if(s.includes('FROM school_calendar_exceptions'))return rows([]);
   if(s.includes('FROM staff_official_business_requests'))return rows([]);
   if(s.includes('AS blocked'))return rows([{blocked:state.appliedLeaves.some(l=>
    l.start_date<='2026-11-24'&&l.end_date>='2026-11-24')}]);
   if(s.includes('all_gate ORDER BY'))return rows(state.gate.map(x=>({
    eventId:x.eventId,eventType:x.eventType,time:x.time})));
   if(s.startsWith('SELECT dtr_slot AS slot'))return rows(state.dtr);
   // Actual automatic gate route's DB operations.
   if(s.includes('SELECT user_id,display_name FROM school_users'))return rows([
    {user_id:teacher,display_name:'Simulated Teacher'}]);
   if(s.includes('FROM staff_attendance_events WHERE school_id=$1 AND client_event_key=$2'))
    return rows([]);
   if(s.includes('FROM staff_attendance_audit a'))return rows([]);
   if(s.includes('SELECT clock_timestamp() AS occurred_at'))
    return rows([{occurred_at:'2026-11-24T07:15:00+08:00',school_date:'2026-11-24'}]);
   if(s.includes(') gate_history ORDER BY'))return rows([]);
   if(s.startsWith('INSERT INTO staff_attendance_events')){
    if(s.includes("'DTR_SLOT'"))throw Error('SAFETY FAILURE: fabricated DTR during leave');
    const e={eventId:args[0],eventType:'TIME_IN',time:'07:15',occurredAt:'2026-11-24T07:15:00+08:00'};
    state.gate.push(e);
    return rows([{eventId:e.eventId,gateDirection:'IN',occurredAt:e.occurredAt}]);
   }
   if(s.startsWith('INSERT INTO audit_logs')){
    state.audits.push({action:'GATE_MOVEMENT_VERIFIED'});return rows([]);
   }
   throw Error('Unmocked SQL: '+s.slice(0,180));
  }
 };
 const pool={connect:async()=>client,query:(...a)=>client.query(...a)};
 const handlers=new Map();
 const app={get:(p,...args)=>handlers.set('GET '+p,args.at(-1)),
  post:(p,...args)=>handlers.set('POST '+p,args.at(-1))};
 registerStaffLeaveRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
 const run=async(method,path,{userId=teacher,role=actors[userId]?.role,body={},params={},query={}}={})=>{
  const auth={type:'SCHOOL_USER',schoolId:school,userId,role,departmentId:actors[userId]?.department_id};
  let status=200,content;
  const res={set(){return res},status(n){status=n;return res},
   json(v){content=v;return res},send(v){content=v;return res}};
  const handler=handlers.get(method+' '+path);assert.ok(handler,'Missing route: '+method+' '+path);
  await handler({auth,body,params,query},res);return {status,body:content};
 };
 return {state,actors,client,pool,run};
}

test('seven-step fictional leave, gate and DTR workflow uses real route functions without external writes',async()=>{
 const sim=fixture(),{state,run,client}=sim;
 // 1. Applicant submits and opens a prefilled official-looking unsigned worksheet.
 const filed=await run('POST','/api/staff-leave/requests',{body:requestBody});
 assert.equal(filed.status,201);assert.equal(filed.body.status,'PENDING_HEAD');
 assert.equal(state.request.credit_account,'VSC');assert.equal(state.credit,5);
 const requestId=filed.body.requestId;
 const form6=await run('GET','/api/staff-leave/requests/:id/form6',{params:{id:requestId}});
 assert.equal(form6.status,200);
 assert.equal(form6.body.request.staffName,'Simulated Teacher');
 assert.equal(form6.body.request.status,'PENDING_HEAD');
 assert.equal(form6.body.estimatedSchoolWorkingDays,2);
 assert.equal(form6.body.applicantSignature,null);
 assert.equal(form6.body.approvingOfficerSignature,null);
 assert.equal(form6.body.officialMonthlySalary,null);
 const printHtml=fs.readFileSync(require.resolve('../public/leave-form6.html'),'utf8');
 const printJS=fs.readFileSync(require.resolve('../public/leave-form6.js'),'utf8');
 assert.match(printHtml,/@page\{size:A4 portrait/);
 assert.match(printJS,/\$\('print'\)\.addEventListener\('click',\(\)=>window\.print\(\)\)/);
 // 2. Unauthorized reviewer rejected, authorized Department Head then Admin forward.
 const noSelf=await run('POST','/api/staff-leave/requests/:id/recommend',{
  params:{id:requestId},body:{decision:'FORWARD'},userId:teacher});
 assert.equal(noSelf.status,403);
 const headResult=await run('POST','/api/staff-leave/requests/:id/recommend',{
  params:{id:requestId},body:{decision:'FORWARD',note:'Recommend for review'},userId:head});
 assert.equal(headResult.status,200);assert.equal(state.request.status,'PENDING_ADMIN');
 const adminResult=await run('POST','/api/staff-leave/requests/:id/admin-review',{
  params:{id:requestId},body:{decision:'FORWARD',note:'Forward documented request'},userId:admin});
 assert.equal(adminResult.status,200);assert.equal(state.request.status,'PENDING_EXTERNAL');
 assert.equal(state.credit,5);
 // 3. Authenticated officer transcribes a decision already signed elsewhere.
 const approval={decision:'APPROVE',approvalReference:'SIM-DO-NOT-FILE-2026',
  approverName:'Fictional Authorized Official',approverPosition:'Fictional Approving Officer',
  approvedOn:'2026-11-23',certifiedWorkingDays:2};
 const noPaper=await run('POST','/api/staff-leave/requests/:id/external-decision',{
  params:{id:requestId},body:approval,userId:admin});
 assert.equal(noPaper.status,409);assert.equal(state.request.status,'PENDING_EXTERNAL');
 state.signedApproval=true;state.credit=1;
 const insufficient=await run('POST','/api/staff-leave/requests/:id/external-decision',{
  params:{id:requestId},body:approval,userId:admin});
 assert.equal(insufficient.status,409);assert.equal(state.appliedLeaves.length,0);
 state.credit=5;
 const final=await run('POST','/api/staff-leave/requests/:id/external-decision',{
  params:{id:requestId},body:approval,userId:admin});
 assert.equal(final.status,200);assert.equal(state.request.status,'APPROVED');
 assert.equal(state.appliedLeaves.length,1);
 assert.equal(state.appliedLeaves[0].approval_reference,approval.approvalReference);
 assert.equal(state.appliedLeaves[0].credit_account,'VSC');
 assert.equal(state.credit,3);assert.equal(state.gate.length,0);assert.equal(state.dtr.length,0);
 // 4. Profile and QR Gatekeeper show the identical authorized date window.
 const status=await getStaffLeaveStatus(client,school,teacher);
 assert.equal(status.status,'ACTIVE');
 assert.equal(status.startDate,'2026-11-23');assert.equal(status.endDate,'2026-11-24');
 assert.equal(requiresDtrReview(status),true);
 const publicBadge=gateVisibleLeave(status);
 assert.equal(publicBadge.approvalReference,approval.approvalReference);
 assert.equal('reason' in publicBadge,false);assert.equal('leaveType' in publicBadge,false);
 // 5. Exercise the actual teacher-auto-event Express handler: physical only.
 const server=fs.readFileSync(require.resolve('../server.js'),'utf8');
 const start=server.indexOf("app.post('/api/gate/teacher-auto-event'");
 const end=server.indexOf('// Roster:',start);
 assert.ok(start>=0&&end>start,'Route markers must be available');
 let gateHandler;
 const app={post:(_p,...handlers)=>gateHandler=handlers.at(-1)};
 vm.runInNewContext(server.slice(start,end),{
  app,pool:sim.pool,authenticateSchoolClient:()=>{},requireSchoolRoles:()=>{},
  isUuid:()=>true,
  require:id=>id.includes('gate-event-decision')?{decideNextGateEvent}:
   id.includes('gate-attendance-boundary')?gateBoundary:
   id.includes('staff-gate-dtr-auto')?{autoRecordVerifiedGateDtr}:
   id==='node:crypto'?crypto:require(id),
  Date,Intl,console
 });
 assert.equal(typeof gateHandler,'function');
 let gateCode=200,gateOutput;
 const response={set(){return response},status(n){gateCode=n;return response},
  json(v){gateOutput=v;return response}};
 await gateHandler({auth:{type:'SCHOOL_USER',role:'GATE_KEEPER',schoolId:school,userId:keeper},
  body:{teacherQrToken:badge,photoVerified:true,clientEventKey:eventKey}},response);
 assert.equal(gateCode,201);
 assert.equal(gateOutput.recordingTarget,'PHYSICAL_GATE');
 assert.equal(gateOutput.autoDtr.status,'REVIEW_REQUIRED');
 assert.equal(gateOutput.autoDtr.reason,'LEAVE_REQUIRES_REVIEW',
  'Recent SQL: '+JSON.stringify(state.queryLog.slice(-15)));
 assert.equal(state.gate.length,1);assert.equal(state.dtr.length,0);
 // 6. Normal Form 48 has approved days and no invented punches;
 // a separate historical punch requires exception handling.
 const approved=state.appliedLeaves[0];
 const leaves=[{from:approved.start_date,to:approved.end_date,
  leaveType:approved.leave_type,creditAccount:approved.credit_account,approvalReference:approved.approval_reference}];
 const form48Args={month:'2026-11',today:'2026-11-24',
  settings:form48Settings,approvedLeaves:leaves};
 const clean=summarizeForm48(form48Args);
 assert.equal(clean.assessments.find(a=>a.date==='2026-11-23').status,'APPROVED_LEAVE');
 assert.equal(clean.assessments.find(a=>a.date==='2026-11-24').status,'APPROVED_LEAVE');
 assert.equal(clean.summary.approvedLeaveDays,2);
 const notes=buildForm48LeaveRemarks('2026-11',leaves,clean.assessments);
 assert.match(notes[0].text,/Nov 23–24 — Approved VSCA \(Vacation Service Credits Applied\) \(Ref\. SIM-DO-NOT-FILE-2026\)/);
 assert.deepEqual(notes[0].conflictDates,[]);
 const conflict=summarizeForm48({...form48Args,records:[{
  date:'2026-11-24',slots:{AM_IN:'07:15'}}]});
 assert.equal(conflict.assessments.find(a=>a.date==='2026-11-24').status,'LEAVE_PUNCH_CONFLICT');
 assert.equal(conflict.summary.daysPresent,0);
 assert.deepEqual(buildForm48LeaveRemarks('2026-11',leaves,conflict.assessments)[0].conflictDates,
  ['2026-11-24']);
 // 7. Officially verified 2 days charge 5 -> 3; no extra debit on QR movement.
 assert.equal(state.credit,3);
 assert.equal(state.audits.filter(a=>a.action==='LEAVE_EXTERNAL_APPROVED').length,1);
 assert.ok(state.notifications.length>0);
 assert.ok(state.commits>=4);
});
