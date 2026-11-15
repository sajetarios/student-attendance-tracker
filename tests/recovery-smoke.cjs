'use strict';
// CI-only end-to-end recovery test with disposable test-school credentials.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { hashPassword, verifyPassword, createOpaqueToken, hashToken } = require('../auth-security');
const { createAuthMiddleware } = require('../auth-middleware');
const { registerSchoolAdminRecoveryRoutes } = require('../school-admin-recovery-routes');

async function main(){
  assert.ok(process.env.DATABASE_URL && /school_attendance_test/.test(process.env.DATABASE_URL),
    'Refuse to run recovery smoke test outside an isolated test database.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const marker = crypto.randomBytes(6).toString('hex');
  const schoolCode = 'RECOV' + marker;
  const platformPassword = 'TestOnlySuperAdmin!2026';
  const oldPassword = 'TestOnlySchoolAdmin!2026';
  const newPassword = 'TestOnlyReplacement!2026';
  const platformLogin = 'recovery-owner-' + marker;
  const schoolLogin = 'recovery-school-admin-' + marker;
  let server, schoolId, platformId, schoolUserId;
  try {
    const school = await pool.query(
      'INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
      [schoolCode,'Recovery validation school']);
    schoolId = school.rows[0].school_id;
    const platform = await pool.query(
      'INSERT INTO platform_users(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING user_id',
      [platformLogin,'Recovery CI Owner',await hashPassword(platformPassword)]);
    platformId = platform.rows[0].user_id;
    const dept=await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
      [schoolId,'UNASSIGNED','Unassigned']);
    const user = await pool.query(
      "INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5,'SCHOOL_ADMIN') RETURNING user_id",
      [schoolId,dept.rows[0].department_id,schoolLogin,'Recovery CI Administrator',await hashPassword(oldPassword)]);
    schoolUserId = user.rows[0].user_id;

    const ownerToken = createOpaqueToken();
    const oldSession = createOpaqueToken();
    await pool.query(
      "INSERT INTO user_sessions(token_hash,principal_type,platform_user_id,expires_at) VALUES($1,'PLATFORM',$2,NOW()+INTERVAL '1 hour')",
      [hashToken(ownerToken),platformId]);
    await pool.query(
      "INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at) VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '1 hour')",
      [hashToken(oldSession),schoolId,schoolUserId]);

    const app = express();
    app.use(express.json());
    const { authenticatePlatform, requirePlatformAdmin } = createAuthMiddleware(pool);
    registerSchoolAdminRecoveryRoutes(app,pool,{authenticatePlatform,requirePlatformAdmin});
    server = await new Promise((resolve,reject)=>{
      const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));
      srv.on('error',reject);
    });
    const address='http://127.0.0.1:' + server.address().port;
    async function post(path,body,token){
      const r=await fetch(address+path,{
        method:'POST',headers:{
          'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})
        },body:JSON.stringify(body)
      });
      return {status:r.status,data:await r.json()};
    }
    const noAuth=await post('/api/platform/recovery/issue',
      {schoolId,userId:schoolUserId,superAdminPassword:platformPassword});
    assert.equal(noAuth.status,401,'Only authenticated platform admins can issue codes');

    const issued=await post('/api/platform/recovery/issue',
      {schoolId,userId:schoolUserId,superAdminPassword:platformPassword},ownerToken);
    assert.equal(issued.status,201,'Super Admin can issue a recovery code');
    assert.match(issued.data.recoveryCode,/^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$/);
    const attempt={
      schoolCode,username:schoolLogin,recoveryCode:issued.data.recoveryCode,
      newPassword,confirmPassword:newPassword
    };
    const completed=await post('/api/auth/school/recover-admin',attempt);
    assert.equal(completed.status,200,'Valid single-use code completes password reset: '+JSON.stringify(completed.data));
    assert.equal(completed.data.recovered,true);
    const reusing=await post('/api/auth/school/recover-admin',attempt);
    assert.equal(reusing.status,400,'Recovery code cannot be reused');

    const account=await pool.query(
      'SELECT password_hash,must_change_password FROM school_users WHERE school_id=$1 AND user_id=$2',
      [schoolId,schoolUserId]);
    assert.equal(await verifyPassword(newPassword,account.rows[0].password_hash),true);
    assert.equal(await verifyPassword(oldPassword,account.rows[0].password_hash),false);
    assert.equal(account.rows[0].must_change_password,false);
    const previousSession=await pool.query('SELECT revoked_at FROM user_sessions WHERE token_hash=$1',[hashToken(oldSession)]);
    assert.ok(previousSession.rows[0].revoked_at,'Existing staff session revoked');
    const audit=await pool.query(
      "SELECT COUNT(*)::int AS count FROM audit_logs WHERE school_id=$1 AND action='SCHOOL_ADMIN_RECOVERY_COMPLETED'",
      [schoolId]);
    assert.equal(audit.rows[0].count,1,'Completion audit event recorded successfully');
    process.stdout.write('PASS: authenticated issuance, SQL audit, one-time redemption, password replacement, session revocation.\n');
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(schoolId) {
      await pool.query('DELETE FROM audit_logs WHERE school_id=$1',[schoolId]).catch(()=>{});
      await pool.query('DELETE FROM schools WHERE school_id=$1',[schoolId]).catch(()=>{});
    }
    if(platformId)await pool.query('DELETE FROM platform_users WHERE user_id=$1',[platformId]).catch(()=>{});
    await pool.end();
  }
}
main().catch(error=>{ console.error(error.message);process.exitCode=1; });
