'use strict';
// Deterministic fictional JHS data: never connect to a production DB.
const test=require('node:test');
const assert=require('node:assert/strict');
const {hasPermission,hasTeacherDesignation}=require('../role-permissions');
const {decideNextGateEvent}=require('../gate-event-decision');
const {validateAutomaticGateRecording,PHYSICAL_GATE}=require('../gate-attendance-boundary');
const {summarizeForm48}=require('../form48-calculations');

const roleMatrix=[
 {role:'SCHOOL_ADMIN',allows:['students.manage','teachers.manage','sf2.official.generate','attendance.corrections.manage'],denies:['attendance.gate.record','attendance.subject.record']},
 {role:'DEPARTMENT_HEAD',allows:['teachers.assign.department','students.manage.department','teachers.substitutions.manage'],denies:['teachers.manage','students.manage','attendance.gate.record','sf2.official.generate']},
 {role:'TEACHER',allows:['attendance.subject.record','attendance.advisory.record','sf2.personal.generate'],denies:['attendance.gate.record','sf2.official.generate','students.manage']},
 {role:'GATE_KEEPER',allows:['gate.lookup','attendance.gate.record'],denies:['students.view.all','students.manage','schedules.manage','sf2.official.generate']},
 {role:'STUDENT',allows:['student.profile.view','student.attendance.view'],denies:['gate.lookup','attendance.gate.record','attendance.subject.record']},
 {role:'PARENT',allows:['parent.children.view','parent.attendance.view'],denies:['gate.lookup','attendance.gate.record','students.view.all']},
 {role:'SUPER_ADMIN',allows:['platform.overview.view'],denies:['attendance.gate.record','attendance.subject.record','students.manage']}
];
for(const person of roleMatrix)test('Fictional JHS '+person.role+' account has only explicit feature permissions',()=>{
 for(const permission of person.allows)assert.equal(hasPermission(person.role,permission),true,person.role+' requires '+permission);
 for(const permission of person.denies)assert.equal(hasPermission(person.role,permission),false,person.role+' must NOT have '+permission);
});

test('Fictional Grade 8 subject teacher and class adviser can have separate designations without gaining gate privileges',()=>{
 const school='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 const subject={type:'SCHOOL_USER',role:'TEACHER',schoolId:school,userId:user,teacherDesignations:['SUBJECT_TEACHER']};
 const adviser={...subject,teacherDesignations:['CLASS_ADVISER']};
 const both={...subject,teacherDesignations:['SUBJECT_TEACHER','CLASS_ADVISER']};
 assert.equal(hasTeacherDesignation(subject,'SUBJECT_TEACHER'),true);
 assert.equal(hasTeacherDesignation(subject,'CLASS_ADVISER'),false);
 assert.equal(hasTeacherDesignation(adviser,'SUBJECT_TEACHER'),false);
 assert.equal(hasTeacherDesignation(adviser,'CLASS_ADVISER'),true);
 assert.equal(hasTeacherDesignation(both,'SUBJECT_TEACHER'),true);
 assert.equal(hasTeacherDesignation(both,'CLASS_ADVISER'),true);
 assert.equal(hasTeacherDesignation({...subject,role:'SCHOOL_ADMIN'},'SUBJECT_TEACHER'),false);
 assert.equal(hasPermission('TEACHER','attendance.gate.record'),false);
});

test('Fictional gate arrival, OB departure, late return and final exit obey physical gate alternation',()=>{
 const scans=[];
 for(const next of ['TIME_IN','TIME_OUT','TIME_IN','TIME_OUT']){
  const decision=decideNextGateEvent(scans);
  assert.equal(decision.status,'READY');
  assert.equal(decision.eventType,next);
  scans.push({eventType:next});
 }
 for(const corrupted of [['TIME_OUT'],['TIME_IN','TIME_IN'],['TIME_IN','TIME_OUT','TIME_OUT']])
  assert.equal(decideNextGateEvent(corrupted).status,'REVIEW');
});
test('Device cannot fabricate a DTR slot, choose gate direction or bypass photo verification',()=>{
 const valid={actorRole:'GATE_KEEPER',photoVerified:true,recordingTarget:PHYSICAL_GATE};
 assert.deepEqual(validateAutomaticGateRecording(valid),{allowed:true});
 for(const role of ['TEACHER','SCHOOL_ADMIN','DEPARTMENT_HEAD','PARENT','STUDENT'])
  assert.equal(validateAutomaticGateRecording({...valid,actorRole:role}).allowed,false);
 for(const target of ['DTR_SLOT','OFFICIAL_BUSINESS','AM_IN','PM_OUT'])
  assert.equal(validateAutomaticGateRecording({...valid,recordingTarget:target}).reason,'DTR_OB_ISOLATION');
 assert.equal(validateAutomaticGateRecording({...valid,photoVerified:false}).reason,'PHOTO_VERIFICATION_REQUIRED');
 assert.equal(validateAutomaticGateRecording({...valid,clientEventType:'TIME_OUT'}).reason,'CLIENT_EVENT_SELECTION_FORBIDDEN');
});

const hours={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const base={month:'2026-11',today:'2026-11-09',
 settings:{workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},dayReviews:{}},
 records:[],officialBusiness:[],calendar:[],approvedLeaves:[]};
const byDate=(result,date)=>result.assessments.find(x=>x.date===date);
test('Fictional verified Monday punches compute tardiness and undertime, not guessed timestamps',()=>{
 const result=summarizeForm48({...base,records:[{date:'2026-11-02',
   slots:{AM_IN:'07:43',AM_OUT:'11:50',PM_IN:'13:05',PM_OUT:'16:48'}}]});
 assert.equal(result.summary.daysPresent,1);
 assert.equal(result.summary.tardyMinutes,18);
 assert.equal(result.summary.undertimeMinutes,22);
 assert.equal(result.summary.tardyDays,1);
 assert.equal(result.summary.undertimeDays,1);
 assert.equal(byDate(result,'2026-11-02').status,'VERIFIED');
 assert.equal(result.summary.daysAbsent,0);
});
test('Missing Form 48 punches do not become absences automatically; today remains not due',()=>{
 const result=summarizeForm48(base);
 assert.equal(result.summary.daysAbsent,0);
 assert.ok(result.summary.pendingAbsentDays>0);
 assert.equal(byDate(result,'2026-11-03').status,'MISSING_REVIEW');
 assert.equal(byDate(result,'2026-11-09').status,'NOT_DUE');
});
test('Approved OB without four punches is review-only, never an invented DTR or approved absence',()=>{
 const result=summarizeForm48({...base,
  officialBusiness:[{from:'2026-11-03',to:'2026-11-03'}]});
 assert.equal(byDate(result,'2026-11-03').status,'APPROVED_OB_REVIEW');
 assert.equal(byDate(result,'2026-11-03').verifiedCount,0);
 assert.equal(result.summary.daysAbsent,0);
});
test('Authorized absence, approved excusal and school closure change only their respective days',()=>{
 const result=summarizeForm48({...base,
  settings:{...base.settings,dayReviews:{'2026-11-04':'ABSENT','2026-11-05':'EXCUSED'}},
  calendar:[{date:'2026-11-06',type:'CLOSED'}]});
 assert.equal(byDate(result,'2026-11-04').status,'CONFIRMED_ABSENT');
 assert.equal(byDate(result,'2026-11-05').status,'EXCUSED');
 assert.equal(byDate(result,'2026-11-06').scheduled,false);
 assert.equal(result.summary.daysAbsent,1);
 assert.equal(result.summary.excusedDays,1);
 assert.equal(byDate(result,'2026-11-07').status,'NOT_SCHEDULED');
});
test('Partial verified staff punches remain incomplete, not full verified attendance',()=>{
 const result=summarizeForm48({...base,records:[{date:'2026-11-02',slots:{AM_IN:'07:35'}}]});
 assert.equal(byDate(result,'2026-11-02').status,'INCOMPLETE_DTR');
 assert.equal(byDate(result,'2026-11-02').verifiedCount,1);
 assert.equal(result.summary.partialRecordDays,1);
 assert.equal(result.summary.daysAbsent,0);
});
