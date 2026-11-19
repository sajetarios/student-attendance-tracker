'use strict';
/* CI-only integration: a school with a completed pilot reset must be deletable
 * without leaving archived rows or touching another school. NEVER run on prod. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { registerPlatformSchoolDeletionRoutes } = require('../platform-school-deletion-routes');

async function run() {
  assert.ok(process.env.DATABASE_URL && /school_attendance_test/.test(process.env.DATABASE_URL),
    'Refuse to run school deletion integration test outside an isolated test database.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const marker = crypto.randomBytes(6).toString('hex');
  const owner = 'platform-delete-' + marker;
  let platformId, targetId, otherId, backupId, server;
  try {
    const platform = await pool.query(
      'INSERT INTO platform_users(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING user_id',
      [owner,'Platform deletion regression admin','test-only-password-hash']);
    platformId = platform.rows[0].user_id;
    const target = await pool.query(
      'INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
      ['DEL'+marker,'Disposable deletion test school']);
    targetId = target.rows[0].school_id;
    const other = await pool.query(
      'INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
      ['KEEP'+marker,'Unaffected school']);
    otherId = other.rows[0].school_id;

    for (const [schoolId,code] of [[targetId,'DEL'+marker],[otherId,'KEEP'+marker]]) {
      const reset=await pool.query(
        'INSERT INTO attendance_pilot_reset_runs(school_id,school_code,reason,archived_rows) VALUES($1,$2,$3,1) RETURNING reset_id',
        [schoolId,code,'Integration test reset '+marker]);
      await pool.query(
        'INSERT INTO attendance_pilot_reset_backup_rows(reset_id,source_table,source_row) VALUES($1,$2,$3::jsonb)',
        [reset.rows[0].reset_id,'attendance_events',JSON.stringify({ schoolCode:code, testOnly:true })]);
    }

    const app=express();
    app.use(express.json());
    registerPlatformSchoolDeletionRoutes(app,pool,{
      authenticatePlatform:(req,res,next)=>{req.auth={userId:platformId};next();},
      requirePlatformAdmin:(_req,_res,next)=>next()
    });
    server=await new Promise((resolve,reject)=>{
      const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));
      srv.on('error',reject);
    });
    const url='http://127.0.0.1:'+server.address().port;
    const previewResponse=await fetch(url+'/api/platform/schools/'+targetId+'/deletion-preview');
    assert.equal(previewResponse.status,200);
    const preview=await previewResponse.json();
    assert.equal(preview.school.schoolId,targetId);

    const rejected=await fetch(url+'/api/platform/schools/'+targetId,{
      method:'DELETE',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({previewToken:preview.previewToken,confirmationPhrase:'DELETE wrong-code'})
    });
    assert.equal(rejected.status,409,'Wrong confirmation phrase cannot delete school');
    const stillPresent=await pool.query('SELECT 1 FROM schools WHERE school_id=$1',[targetId]);
    assert.equal(stillPresent.rowCount,1,'Rejected operation must not modify the target');

    const response=await fetch(url+'/api/platform/schools/'+targetId,{
      method:'DELETE',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({previewToken:preview.previewToken,confirmationPhrase:'DELETE '+preview.school.schoolCode})
    });
    const data=await response.json();
    assert.equal(response.status,200,'Deletion should succeed with pilot archive foreign keys: '+JSON.stringify(data));
    assert.equal(data.deleted,true);
    assert.equal(data.schoolId,targetId);
    assert.ok(data.backupId,'Deleted school has verified backup');
    backupId=data.backupId;
    assert.equal((await pool.query('SELECT 1 FROM schools WHERE school_id=$1',[targetId])).rowCount,0);
    assert.equal((await pool.query('SELECT 1 FROM schools WHERE school_id=$1',[otherId])).rowCount,1);
    const remainingTargetReset=await pool.query('SELECT 1 FROM attendance_pilot_reset_runs WHERE school_id=$1',[targetId]);
    assert.equal(remainingTargetReset.rowCount,0);
    const otherArchive=await pool.query(
      'SELECT count(*)::int AS count FROM attendance_pilot_reset_backup_rows b JOIN attendance_pilot_reset_runs r ON b.reset_id=r.reset_id WHERE r.school_id=$1',[otherId]);
    assert.equal(otherArchive.rows[0].count,1,'Other school archives must remain untouched');
    const archived=await pool.query(
      "SELECT source_table,count(*)::int AS count FROM platform_school_deletion_backup_rows WHERE backup_id=$1 AND source_table IN ('attendance_pilot_reset_backup_rows','attendance_pilot_reset_runs') GROUP BY source_table",
      [backupId]);
    const archiveCounts=Object.fromEntries(archived.rows.map(row=>[row.source_table,row.count]));
    assert.equal(archiveCounts.attendance_pilot_reset_backup_rows,1,'Deleted pilot archive row must be in recovery snapshot');
    assert.equal(archiveCounts.attendance_pilot_reset_runs,1,'Deleted pilot reset run must be in recovery snapshot');
    const snapshot=await pool.query('SELECT row_count FROM platform_school_deletion_backups WHERE backup_id=$1',[backupId]);
    assert.equal(snapshot.rows[0].row_count,data.backedUpRows,'Snapshot count must match actual archived rows');
    process.stdout.write('PASS: pilot reset FK, two confirmations, verified recovery snapshot, other-school isolation.\\n');
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(backupId)await pool.query('DELETE FROM platform_school_deletion_backups WHERE backup_id=$1',[backupId]).catch(()=>{});
    for(const schoolId of [targetId,otherId].filter(Boolean)) {
      await pool.query('DELETE FROM attendance_pilot_reset_backup_rows WHERE reset_id IN (SELECT reset_id FROM attendance_pilot_reset_runs WHERE school_id=$1)',[schoolId]).catch(()=>{});
      await pool.query('DELETE FROM attendance_pilot_reset_runs WHERE school_id=$1',[schoolId]).catch(()=>{});
      await pool.query('DELETE FROM schools WHERE school_id=$1',[schoolId]).catch(()=>{});
    }
    if(platformId) {
      await pool.query("DELETE FROM audit_logs WHERE actor_type='PLATFORM' AND actor_user_id=$1",[platformId]).catch(()=>{});
      await pool.query('DELETE FROM platform_users WHERE user_id=$1',[platformId]).catch(()=>{});
    }
    await pool.end();
  }
}
run().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
