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
    console.log('Notification migration, event idempotence and reread smoke checks passed.');
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
    await pool.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
