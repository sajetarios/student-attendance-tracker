'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {normalizeCode,recoveryDigest,registerSchoolAdminRecoveryRoutes}=require('../school-admin-recovery-routes');
const source=fs.readFileSync(path.join(__dirname,'../school-admin-recovery-routes.js'),'utf8');
test('code input normalizes, and persisted digests do not contain plaintext',()=>{
  const code='ABCDEF-012345-ABCDEF-012345';
  assert.equal(normalizeCode(code),'ABCDEF012345ABCDEF012345');
  assert.equal(normalizeCode('invalid'),'');
  assert.equal(recoveryDigest(normalizeCode(code)).length,64);
  assert.notEqual(recoveryDigest(normalizeCode(code)),normalizeCode(code));
});
test('platform routes require both authentication and super-admin authorization',()=>{
  const endpoints={};const guard=()=>{},admin=()=>{};
  const app={get(path,...rest){endpoints[path]=rest;},post(path,...rest){endpoints[path]=rest;}};
  registerSchoolAdminRecoveryRoutes(app,{}, {authenticatePlatform:guard,requirePlatformAdmin:admin});
  for(const path of ['/api/platform/recovery/school-admins','/api/platform/recovery/issue']){
    assert.equal(endpoints[path][0],guard);assert.equal(endpoints[path][1],admin);
  }
  assert.ok(endpoints['/api/auth/school/recover-admin']);
  assert.match(source,/su\.role='SCHOOL_ADMIN'/);
  assert.match(source,/verifyPassword\(superAdminPassword/);
  assert.match(source,/used_at IS NULL AND revoked_at IS NULL AND expires_at>NOW\(\)/);
  assert.match(source,/UPDATE user_sessions SET revoked_at=NOW\(\)/);
});
