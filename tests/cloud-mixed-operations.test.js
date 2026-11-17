'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {
  queueCloudOperation,receiveCloudOperation,NeedsReview,validateOperation
}=require('../cloud-mixed-operations');

const school='11111111-1111-4111-8111-111111111111';
const teacher='22222222-2222-4222-8222-222222222222';
const period='33333333-3333-4333-8333-333333333333';
const opId='44444444-4444-4444-8444-444444444444';
const base=()=>({
  operationId:opId,type:'MANUAL_MARKS',date:'2026-11-16',actorUsername:'teacher.1',
  period:{periodName:'Period 1',gradeLevel:'8',section:'Rizal',
    subjectName:'English',startTime:'08:00',endTime:'09:00'},
  marks:[{studentId:'STUDENT-001',status:'PRESENT',note:'',expectedRevision:0,revision:1}]
});
function fakeCloud({existingMark=null,actor=true,periodMapped=true,completed=1}={}){
  const state={queries:[],receipt:null,mark:existingMark,eventCount:0,markChanges:0,actor};
  const client={async query(sql,params=[]){
    state.queries.push({sql,params});
    if(sql.includes('FROM cloud_sync_operation_receipts WHERE operation_id=$1')){
      return {rowCount:state.receipt?1:0,rows:state.receipt?[state.receipt]:[]};
    }
    if(sql.includes('SELECT user_id FROM school_users'))
      return {rowCount:actor?1:0,rows:actor?[{user_id:teacher}]:[]};
    if(sql.includes('SELECT period_id,grade_level,section FROM class_periods'))
      return {rowCount:periodMapped?1:0,rows:periodMapped?[{period_id:period,grade_level:'8',section:'Rizal'}]:[]};
    if(sql.includes('SELECT 1 FROM class_periods p'))return {rowCount:1,rows:[{}]};
    if(sql.includes('FROM class_attendance_finalizations') && sql.includes('SELECT 1'))
      return {rowCount:0,rows:[]};
    if(sql.includes('SELECT 1 FROM students s'))return {rowCount:1,rows:[{}]};
    if(sql.includes('SELECT status,note,revision FROM manual_attendance_marks'))
      return {rowCount:state.mark?1:0,rows:state.mark?[state.mark]:[]};
    if(sql.includes('INSERT INTO manual_attendance_marks')){
      state.markChanges++;state.mark={status:params[4],note:params[5],revision:1};
      return {rowCount:1,rows:[{revision:1}]};
    }
    if(sql.includes('UPDATE manual_attendance_marks')){
      state.markChanges++;state.mark={status:params[4],note:params[5],revision:Number(params[7])+1};
      return {rowCount:1,rows:[{revision:state.mark.revision}]};
    }
    if(sql.includes('INSERT INTO cloud_sync_operation_receipts')){
      state.receipt={school_id:params[0],operation_type:params[2],payload_hash:params[3]};
      state.eventCount++;
      return {rowCount:1,rows:[]};
    }
    if(sql.includes('SELECT finalized,roster_count FROM class_attendance_finalizations'))
      return {rowCount:0,rows:[]};
    if(sql.includes('COUNT(*)::int AS total'))return {rowCount:1,rows:[{total:1,completed}]};
    if(sql.includes('FROM school_calendar_exceptions'))return {rowCount:0,rows:[]};
    if(sql.includes('SELECT 1 FROM manual_attendance_marks m'))return {rowCount:0,rows:[]};
    if(sql.includes('INSERT INTO class_attendance_finalization_events')){state.eventCount++;return {rowCount:1,rows:[]};}
    return {rowCount:0,rows:[]};
  }};
  return {client,state};
}

test('cloud accepts typed manual marks once and returns durable idempotent replay',async()=>{
  const {client,state}=fakeCloud();
  const first=await receiveCloudOperation(client,school,base());
  assert.equal(first.status,'ACCEPTED');
  assert.equal(state.markChanges,1);
  assert.equal(state.eventCount,1);
  const again=await receiveCloudOperation(client,school,base());
  assert.equal(again.status,'ALREADY_SYNCED');
  assert.equal(state.markChanges,1);
  assert.equal(state.eventCount,1);
  assert.ok(state.queries.some(x=>x.sql.includes('pg_advisory_xact_lock')));
});
test('stale cloud revision never edits or acknowledges a conflicting learner mark',async()=>{
  const {client,state}=fakeCloud({existingMark:{status:'ABSENT',note:'',revision:9}});
  await assert.rejects(receiveCloudOperation(client,school,base()),
    error=>error instanceof NeedsReview && error.code==='STALE_CLOUD_MARK');
  assert.equal(state.markChanges,0);
  assert.equal(state.receipt,null);
});
test('signed local operation cannot forge an unprovisioned teacher identity',async()=>{
  const {client}=fakeCloud({actor:false});
  await assert.rejects(receiveCloudOperation(client,school,base()),
    error=>error instanceof NeedsReview && error.code==='ACTOR_MAPPING');
});
test('unknown cloud class period is reviewed rather than auto-created',async()=>{
  const {client,state}=fakeCloud({periodMapped:false});
  await assert.rejects(receiveCloudOperation(client,school,base()),
    error=>error instanceof NeedsReview && error.code==='PERIOD_MAPPING');
  assert.equal(state.markChanges,0);
});
test('register cannot be finalized on the cloud until all learners are confirmed',async()=>{
  const {client}=fakeCloud({completed:0});
  const op={...base(),type:'REGISTER_SIGNOFF',action:'FINALIZE',rosterCount:1};
  delete op.marks;
  await assert.rejects(receiveCloudOperation(client,school,op),
    error=>error instanceof NeedsReview && error.code==='ROSTER_MISMATCH');
});
test('reusing a receipt UUID for a different school or payload is rejected',async()=>{
  const {client}=fakeCloud();
  await receiveCloudOperation(client,school,base());
  const altered={...base(),marks:[{...base().marks[0],status:'LATE'}]};
  await assert.rejects(receiveCloudOperation(client,school,altered),
    error=>error instanceof NeedsReview && error.code==='OPERATION_ID_CONFLICT');
});
test('local accepted edits are written to typed cloud outbox with exact teacher and period mapping',async()=>{
  let inserted=null;
  const client={async query(sql,params){
    if(sql.includes('FROM school_cloud_sync_settings'))return {rowCount:1,rows:[{}]};
    if(sql.includes('FROM school_users su JOIN class_periods p'))return {rowCount:1,
      rows:[{username:'teacher.1',period_name:'Period 1',grade_level:'8',section:'Rizal',
        subject_name:'English',start_time:'08:00',end_time:'09:00'}]};
    if(sql.includes('INSERT INTO school_cloud_sync_operations')){
      inserted={sql,params};return {rowCount:1,rows:[]};
    }
    throw new Error('Unexpected SQL '+sql.slice(0,80));
  }};
  const saved=await queueCloudOperation(client,{
    schoolId:school,operationId:opId,type:'MANUAL_MARKS',periodId:period,
    date:'2026-11-16',actorUserId:teacher,marks:base().marks
  });
  assert.equal(saved,true);
  assert.equal(inserted.params[2],'MANUAL_MARKS');
  const payload=JSON.parse(inserted.params[3]);
  assert.equal(payload.operationId,opId);
  assert.equal(payload.actorUsername,'teacher.1');
  assert.equal(payload.period.section,'Rizal');
});
test('typed operations reject invalid dates and duplicate learners before any database write',()=>{
  assert.throws(()=>validateOperation({...base(),date:'2026-02-30'}),NeedsReview);
  assert.throws(()=>validateOperation({...base(),marks:[base().marks[0],base().marks[0]]}),NeedsReview);
});
