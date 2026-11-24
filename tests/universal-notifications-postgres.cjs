'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('pg');
async function main() {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL required for notification smoke test.');
  const pool = new Pool({connectionString: process.env.DATABASE_URL});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const table = await client.query("SELECT to_regclass('public.user_notifications') AS name");
    assert.equal(table.rows[0].name, 'user_notifications');
    const trg = await client.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname IN ('guardian_request_notification','student_account_request_notification','special_program_request_notification','photo_request_notification','parent_link_notification','school_platform_notification') AND NOT tgisinternal");
    assert.equal(trg.rows[0].count, 6);
    const recipient = '11111111-1111-4111-8111-111111111111';
    const attrs = [null,'PLATFORM',recipient,'smoke:test','SYSTEM','Test alert','A status was changed.','System',null,'TEST','/portal.html'];
    await client.query('SELECT attendigo_notify($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',attrs);
    await client.query('SELECT attendigo_notify($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',attrs);
    let rows = await client.query('SELECT notification_id,read_at FROM user_notifications WHERE recipient_kind=$1 AND recipient_id=$2 AND event_key=$3',['PLATFORM',recipient,'smoke:test']);
    assert.equal(rows.rowCount,1,'retries must not create duplicate events');
    await client.query("UPDATE user_notifications SET read_at=NOW() WHERE notification_id=$1",[rows.rows[0].notification_id]);
    await client.query('SELECT attendigo_notify($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[...attrs,true]);
    rows = await client.query('SELECT read_at FROM user_notifications WHERE recipient_kind=$1 AND recipient_id=$2 AND event_key=$3',['PLATFORM',recipient,'smoke:test']);
    assert.equal(rows.rows[0].read_at,null,'a changed batch status must become unread');
    const schoolA=(await client.query("INSERT INTO schools(school_code,school_name) VALUES('NTF'+left(gen_random_uuid()::text,8),'Notification test') RETURNING school_id")).rows[0].school_id;
    const schoolB=(await client.query("INSERT INTO schools(school_code,school_name) VALUES('NTF'+left(gen_random_uuid()::text,8),'Other school') RETURNING school_id")).rows[0].school_id;
    const dept=(await client.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'SCI','Science') RETURNING department_id",[schoolA])).rows[0].department_id;
    async function account(school,department,role,name){return (await client.query("INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations) VALUES($1,$2,$3,$3,'test-hash',$4,ARRAY[]::text[]) RETURNING user_id",[school,department,name,role])).rows[0].user_id;}
    const admin=await account(schoolA,dept,'SCHOOL_ADMIN','admin'),head=await account(schoolA,dept,'DEPARTMENT_HEAD','head');
    const outsideDept=(await client.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'SCI','Science') RETURNING department_id",[schoolB])).rows[0].department_id;
    const outsider=await account(schoolB,outsideDept,'SCHOOL_ADMIN','admin');
    const key='staff_lunch_geo_proposal_'+dept,proposal={status:'PENDING',proposedBy:head,proposedAt:new Date().toISOString(),point:{latitude:1,longitude:2}};
    await client.query("INSERT INTO school_settings(school_id,setting_key,setting_value) VALUES($1,$2,$3::jsonb)",[schoolA,key,JSON.stringify(proposal)]);
    const alerts=async()=> (await client.query("SELECT recipient_id,status,category,action_url,read_at FROM user_notifications WHERE request_type='DEPARTMENT_LOCATION' AND request_id=$1 ORDER BY category",[dept])).rows;
    let list=await alerts();assert.equal(list.length,1);assert.equal(list[0].recipient_id,admin);assert.equal(list[0].action_url,'/portal.html?view=lunchQrAdmin');
    await client.query("UPDATE school_settings SET setting_value=$3::jsonb WHERE school_id=$1 AND setting_key=$2",[schoolA,key,JSON.stringify({...proposal,status:'APPROVED'})]);
    list=await alerts();assert.equal(list.length,2);assert.equal(list.find(x=>x.category==='REQUEST').recipient_id,head);assert.equal(list.find(x=>x.category==='APPROVAL').status,'APPROVED');assert.ok(list.find(x=>x.category==='APPROVAL').read_at);assert.ok(!list.some(x=>x.recipient_id===outsider));
    console.log('Notification migration, event idempotence, tenant isolation and department location lifecycle checks passed.');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
    await pool.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
