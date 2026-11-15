'use strict';
// Server-enforced restriction: Super Admin may issue only for active School Admin.
const crypto = require('node:crypto');
const { hashPassword, hashToken, verifyPassword } = require('./auth-security');
const { createIpRateLimiter } = require('./request-limiter');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalidCode = 'The recovery details are invalid, expired, or already used. Contact your Super Admin for a new code.';
function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 48) return '';
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-F0-9]{24}$/.test(code) ? code : '';
}
function recoveryDigest(code) { return hashToken('school-admin-recovery:' + code); }
function registerSchoolAdminRecoveryRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin }) {
  const guard = [authenticatePlatform, requirePlatformAdmin];
  const issueLimit = createIpRateLimiter({windowMs:900000,maxRequests:12,message:'Too many code requests. Try again later.'});
  const redeemLimit = createIpRateLimiter({windowMs:900000,maxRequests:8,message:'Too many recovery attempts. Try again later.'});

  app.get('/api/platform/recovery/school-admins', ...guard, async (_req,res) => {
    try {
      const result = await pool.query(`
        SELECT su.school_id AS "schoolId",s.school_code AS "schoolCode",
               s.school_name AS "schoolName",su.user_id AS "userId",
               su.username,su.display_name AS "displayName"
        FROM school_users su JOIN schools s ON s.school_id=su.school_id AND s.active=TRUE
        WHERE su.role='SCHOOL_ADMIN' AND su.active=TRUE
        ORDER BY s.school_name,su.display_name`);
      return res.json({administrators:result.rows});
    } catch (error) {
      console.error('Recovery account list failed:',error.message);
      return res.status(500).json({error:'Unable to load School Administrators.'});
    }
  });

  app.post('/api/platform/recovery/issue', ...guard, issueLimit, async (req,res) => {
    const {schoolId,userId,superAdminPassword}=req.body||{};
    if(!UUID.test(schoolId||'')||!UUID.test(userId||'')||
       typeof superAdminPassword!=='string'||!superAdminPassword||superAdminPassword.length>256)
      return res.status(400).json({error:'Select a School Administrator and confirm your Super Admin password.'});
    let client;
    try {
      const actor=await pool.query('SELECT password_hash FROM platform_users WHERE user_id=$1 AND active=TRUE',[req.auth.userId]);
      if(!actor.rowCount||!await verifyPassword(superAdminPassword,actor.rows[0].password_hash))
        return res.status(403).json({error:'Super Admin password confirmation failed.'});
      client=await pool.connect();
      await client.query('BEGIN');
      const found=await client.query(`
        SELECT su.user_id,su.username,su.display_name FROM school_users su
        JOIN schools s ON s.school_id=su.school_id
        WHERE su.school_id=$1 AND su.user_id=$2 AND su.role='SCHOOL_ADMIN'
          AND su.active=TRUE AND s.active=TRUE FOR UPDATE OF su`,[schoolId,userId]);
      if(!found.rowCount){
        await client.query('ROLLBACK');
        return res.status(404).json({error:'Selected active School Admin account was not found.'});
      }
      await client.query(`
        UPDATE school_admin_recovery_codes SET revoked_at=NOW()
        WHERE school_id=$1 AND school_user_id=$2 AND used_at IS NULL AND revoked_at IS NULL`,[schoolId,userId]);
      const rawCode=crypto.randomBytes(12).toString('hex').toUpperCase();
      const expiresAt=new Date(Date.now()+15*60*1000);
      await client.query(`
        INSERT INTO school_admin_recovery_codes
          (school_id,school_user_id,issued_by_platform_user_id,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5)`,[schoolId,userId,req.auth.userId,recoveryDigest(rawCode),expiresAt]);
      await client.query(`
        INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
        VALUES($1,'PLATFORM',$2,'PLATFORM_ISSUE_SCHOOL_ADMIN_RECOVERY','school_user',$3,'{}'::jsonb)`,
        [schoolId,req.auth.userId,userId]);
      await client.query('COMMIT');
      return res.status(201).json({
        userId,username:found.rows[0].username,displayName:found.rows[0].display_name,
        recoveryCode:rawCode.match(/.{1,6}/g).join('-'),expiresAt:expiresAt.toISOString(),expiresInMinutes:15
      });
    } catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('Recovery issuance failed:',error.message);
      return res.status(500).json({error:'Unable to issue recovery code.'});
    } finally {if(client)client.release();}
  });

  app.post('/api/auth/school/recover-admin', redeemLimit, async (req,res) => {
    const {schoolCode,username,recoveryCode,newPassword,confirmPassword}=req.body||{};
    const code=normalizeCode(recoveryCode);
    if(typeof schoolCode!=='string'||schoolCode.length>80||!schoolCode.trim()||
       typeof username!=='string'||username.length>80||!username.trim()||!code)
      return res.status(400).json({error:invalidCode});
    if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256||
       confirmPassword!==newPassword||newPassword.toLowerCase()===username.trim().toLowerCase())
      return res.status(400).json({error:'Enter matching new passwords of 12–256 characters, different from your username.'});
    let client;
    try {
      client=await pool.connect();
      await client.query('BEGIN');
      const found=await client.query(`
        SELECT su.user_id,su.school_id,su.password_hash FROM school_users su
        JOIN schools s ON s.school_id=su.school_id
        WHERE lower(s.school_code)=lower($1) AND lower(su.username)=lower($2)
          AND s.active=TRUE AND su.active=TRUE AND su.role='SCHOOL_ADMIN'
        FOR UPDATE OF su`,[schoolCode.trim(),username.trim()]);
      if(!found.rowCount){
        await client.query('ROLLBACK');
        return res.status(400).json({error:invalidCode});
      }
      const account=found.rows[0];
      const match=await client.query(`
        SELECT recovery_id FROM school_admin_recovery_codes
        WHERE school_id=$1 AND school_user_id=$2 AND code_hash=$3
          AND used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,
        [account.school_id,account.user_id,recoveryDigest(code)]);
      if(!match.rowCount){
        await client.query('ROLLBACK');
        return res.status(400).json({error:invalidCode});
      }
      if(await verifyPassword(newPassword,account.password_hash)){
        await client.query('ROLLBACK');
        return res.status(400).json({error:'Choose a password different from the previous password.'});
      }
      const digest=await hashPassword(newPassword);
      await client.query('UPDATE school_admin_recovery_codes SET used_at=NOW() WHERE recovery_id=$1',
        [match.rows[0].recovery_id]);
      await client.query(`
        UPDATE school_users SET password_hash=$3,must_change_password=FALSE,
          failed_login_attempts=0,locked_until=NULL,session_version=session_version+1,updated_at=NOW()
        WHERE school_id=$1 AND user_id=$2 AND role='SCHOOL_ADMIN'`,[account.school_id,account.user_id,digest]);
      await client.query(`
        UPDATE user_sessions SET revoked_at=NOW()
        WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
        [account.school_id,account.user_id]);
      await client.query(`
        INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
        VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_RECOVERY_COMPLETED','school_user',$2::text,'{}'::jsonb)`,
        [account.school_id,account.user_id]);
      await client.query('COMMIT');
      return res.json({recovered:true,message:'Password updated. Sign in using your new School Admin password.'});
    } catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('School Admin recovery failed:',error.message);
      return res.status(500).json({error:'Unable to complete password recovery.'});
    } finally {if(client)client.release();}
  });
}
module.exports={registerSchoolAdminRecoveryRoutes,normalizeCode,recoveryDigest};
