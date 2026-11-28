'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {issueOfflineLease,verifyOfflineLease,MAX_MS}=require('../offline-authorization-lease');
const pair=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const signer=pair(), device=pair(), other=pair();
const issuer=signer.publicKey.export({format:'jwk'});
const key=device.publicKey.export({format:'jwk'});
const now=Date.parse('2026-11-28T00:00:00Z');
const base={user:{role:'TEACHER',schoolId:'school-a',userId:'teacher-a',departmentId:'dep-a'},sessionId:'session-a',expiresAt:new Date(now+2*MAX_MS).toISOString(),devicePublicKey:key,privateKey:signer.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),now};
const getClaims=lease=>JSON.parse(Buffer.from(lease.payload,'base64url').toString());
function context(lease){const c=getClaims(lease);return {lease,trustedIssuer:issuer,expected:{role:c.role,schoolId:c.schoolId,accountId:c.accountId,departmentId:c.departmentId,epoch:c.epoch},devicePublicKey:key,now,lastObservedAt:now};}
test('issues a signed lease for every eligible school role, never a bearer token',()=>{
 for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']){
  const lease=issueOfflineLease({...base,user:{...base.user,role,studentAccountId:'student-a'}});
  const c=verifyOfflineLease(context(lease));
  assert.ok(c);assert.equal(c.role,role);assert.equal(c.accountId,role==='STUDENT'?'student-a':'teacher-a');
  assert.equal(c.expiresAt,now+MAX_MS);assert.equal(c.departmentId,'dep-a');assert.notEqual(c.epoch,base.sessionId);
  assert.deepEqual(Object.keys(lease).sort(),['issuerPublicKey','payload','signature']);
 }
});
test('leases cannot outlive the authenticated session and expire at the boundary',()=>{
 const lease=issueOfflineLease({...base,expiresAt:new Date(now+1000).toISOString()});
 assert.equal(getClaims(lease).expiresAt,now+1000);
 assert.ok(verifyOfflineLease({...context(lease),now:now+999}));
 assert.equal(verifyOfflineLease({...context(lease),now:now+1000}),null);
});
test('rejects tampering, mismatched identity, epoch, device, untrusted issuer and clock rollback',()=>{
 const lease=issueOfflineLease(base), ctx=context(lease);
 const altered={...getClaims(lease),role:'SCHOOL_ADMIN'};
 assert.equal(verifyOfflineLease({...ctx,lease:{...lease,payload:Buffer.from(JSON.stringify(altered)).toString('base64url')}}),null);
 for(const change of [{role:'PRINCIPAL'},{schoolId:'school-b'},{accountId:'teacher-b'},{epoch:'revoked'},{departmentId:'dep-b'},{departmentId:null}]){
  assert.equal(verifyOfflineLease({...ctx,expected:{...ctx.expected,...change}}),null);
 }
 assert.equal(verifyOfflineLease({...ctx,devicePublicKey:other.publicKey.export({format:'jwk'})}),null);
 assert.equal(verifyOfflineLease({...ctx,trustedIssuer:other.publicKey.export({format:'jwk'})}),null);
 assert.equal(verifyOfflineLease({...ctx,lastObservedAt:now+1}),null);
 assert.equal(verifyOfflineLease({...ctx,lastObservedAt:undefined}),null);
 assert.equal(verifyOfflineLease({...ctx,lease:{...lease,signature:'invalid'}}),null);
});
test('fails closed for missing signing configuration, expired session, invalid device or ineligible identity',()=>{
 for(const [input,status] of [
  [{privateKey:''},503],[{expiresAt:undefined},401],[{expiresAt:new Date(now).toISOString()},401],
  [{devicePublicKey:{...key,d:'private'}},400],[{devicePublicKey:{kty:'RSA'}},400],
  [{user:{...base.user,role:'SUPER_ADMIN'}},403],[{user:{...base.user,mustChangePassword:true}},403],
  [{user:{...base.user,schoolId:null}},403],[{sessionId:null},403]
 ]) assert.throws(()=>issueOfflineLease({...base,...input}),e=>e.status===status);
});

test('requires explicit current department scope, including for school-wide accounts',()=>{
 const lease=issueOfflineLease({...base,user:{...base.user,role:'SCHOOL_ADMIN',departmentId:null}}),ctx=context(lease);
 assert.ok(verifyOfflineLease(ctx));
 const {departmentId,...missing}=ctx.expected;
 assert.equal(verifyOfflineLease({...ctx,expected:missing}),null);
 assert.equal(verifyOfflineLease({...ctx,expected:{...ctx.expected,departmentId:'dep-a'}}),null);
});
