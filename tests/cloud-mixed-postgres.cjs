'use strict';
// Runs only against a fresh isolated CI PostgreSQL database AFTER migrations.
// All fixture changes are rolled back; this script never targets the production DB.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const {receiveCloudOperation,NeedsReview}=require('../cloud-mixed-operations');

async function main(){
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required for the isolated cloud integration smoke test.');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const client=await pool.connect();
  const school=crypto.randomUUID(),teacher=crypto.randomUUID(),period=crypto.randomUUID(),department=crypto.randomUUID();
  const student='SYNC-TEST-'+crypto.randomUUID();
  const op=()=>({
    operationId:crypto.randomUUID(),type:'MANUAL_MARKS',date:'2026-11-16',
    actorUsername:'cloud-test-teacher',
    period:{periodName:'Period 1',gradeLevel:'Grade 8',section:'Rizal',
      subjectName:'English',startTime:'08:00',endTime:'09:00'},
    marks:[{studentId:student,status:'PRESENT',note:'',expectedRevision:0,revision:1}]
  });
  try{
    await client.query('BEGIN');
    await client.query('INSERT INTO schools(school_id,school_code,school_name) VALUES($1,$2,$3)',
      [school,'TEST-'+crypto.randomUUID().slice(0,8),'Synthetic Cloud Sync Test School']);
    await client.query(`INSERT INTO school_departments
      (department_id,school_id,department_code,department_name)
      VALUES($1,$2,'TEST','Synthetic Test Department')`,[department,school]);
    await client.query(`INSERT INTO school_users(user_id,school_id,department_id,
      username,display_name,password_hash,role,teacher_designations)
      VALUES($1,$2,$3,'cloud-test-teacher','Synthetic Teacher','no-login-test-hash','TEACHER',
      ARRAY['SUBJECT_TEACHER']::TEXT[])`,[teacher,school,department]);
    await client.query(`INSERT INTO class_periods(period_id,school_id,department_id,
      period_name,grade_level,section,subject_name,start_time,end_time)
      VALUES($1,$2,$3,'Period 1','Grade 8','Rizal','English','08:00','09:00')`,
      [period,school,department]);
    await client.query(`INSERT INTO teacher_period_assignments(school_id,teacher_user_id,period_id)
      VALUES($1,$2,$3)`,[school,teacher,period]);
    await client.query(`INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile)
      VALUES($1,$2,'Synthetic Student','Grade 8','Rizal','')`,[school,student]);

    const first=op();
    assert.equal((await receiveCloudOperation(client,school,first)).status,'ACCEPTED');
    assert.equal((await receiveCloudOperation(client,school,first)).status,'ALREADY_SYNCED');
    let mark=(await client.query(`SELECT status,revision FROM manual_attendance_marks
      WHERE school_id=$1 AND period_id=$2 AND student_id=$3`,[school,period,student])).rows[0];
    assert.equal(mark.status,'PRESENT');
    assert.equal(Number(mark.revision),1);

    const second=op();
    second.marks[0]={...first.marks[0],status:'ABSENT',note:'Confirmed paper correction',
      expectedRevision:1,revision:2};
    assert.equal((await receiveCloudOperation(client,school,second)).status,'ACCEPTED');
    mark=(await client.query(`SELECT status,note,revision FROM manual_attendance_marks
      WHERE school_id=$1 AND period_id=$2 AND student_id=$3`,[school,period,student])).rows[0];
    assert.equal(mark.status,'ABSENT');
    assert.equal(Number(mark.revision),2);
    const audit=await client.query(`SELECT count(*)::int AS total FROM manual_attendance_audit
      WHERE school_id=$1 AND period_id=$2 AND student_id=$3`,[school,period,student]);
    assert.equal(audit.rows[0].total,2,'Each accepted manual change must have an audit entry');

    const stale=op();
    stale.marks[0]={...first.marks[0],status:'LATE',expectedRevision:1,revision:2};
    await assert.rejects(receiveCloudOperation(client,school,stale),
      err=>err instanceof NeedsReview&&err.code==='STALE_CLOUD_MARK');
    assert.equal((await client.query(`SELECT revision FROM manual_attendance_marks
      WHERE school_id=$1 AND period_id=$2 AND student_id=$3`,[school,period,student]))
      .rows[0].revision.toString(),'2');

    const signed={...op(),type:'REGISTER_SIGNOFF',action:'FINALIZE',rosterCount:1};
    delete signed.marks;
    assert.equal((await receiveCloudOperation(client,school,signed)).status,'ACCEPTED');
    assert.equal((await receiveCloudOperation(client,school,signed)).status,'ALREADY_SYNCED');
    const final=await client.query('SELECT finalized FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2',
      [school,period]);
    assert.equal(final.rows[0].finalized,true);

    const late=op();
    late.marks[0]={...first.marks[0],status:'LATE',expectedRevision:2,revision:3};
    await assert.rejects(receiveCloudOperation(client,school,late),
      err=>err instanceof NeedsReview && err.code==='FINALIZED_REGISTER');
    const receipts=await client.query('SELECT count(*)::int AS total FROM cloud_sync_operation_receipts WHERE school_id=$1',
      [school]);
    assert.equal(receipts.rows[0].total,3,'Two manual changes plus one sign-off receipt');
    process.stdout.write('Cloud mixed relay Postgres smoke passed: tenant mapping, audit, revisions, stale edit, replay, finalization.\n');
  } finally{
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
    await pool.end();
  }
}
main().catch(err=>{console.error(err.stack||err.message);process.exitCode=1;});
