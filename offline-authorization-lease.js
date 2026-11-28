'use strict';
// Signed offline capability, not a bearer token or a substitute for online authorization.
// No private signing key is generated implicitly: stable, environment-specific keys
// must be provisioned deliberately before this feature can issue leases.
const {createPrivateKey,createPublicKey,createHash,sign,verify} = require('node:crypto');
const MAX_MS = 12 * 60 * 60 * 1000;
const ROLES = new Set(['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']);
const audience = 'attendigo:offline-dashboard:v1';
class LeaseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function signingKey(encoded) {
  try {
    if (typeof encoded !== 'string' || !encoded || encoded.length > 4096) throw Error();
    const key = createPrivateKey({key:Buffer.from(encoded,'base64'),format:'der',type:'pkcs8'});
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
    return key;
  } catch { throw new LeaseError(503,'Offline authorization is not configured.'); }
}
function deviceKey(jwk) {
  try {
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk ||
        !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) throw Error();
    return createPublicKey({key:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y},format:'jwk'});
  } catch { throw new LeaseError(400,'A valid P-256 device public key is required.'); }
}
function thumbprint(key) {
  const {crv,kty,x,y}=key.export({format:'jwk'});
  return createHash('sha256').update(JSON.stringify({crv,kty,x,y})).digest('base64url');
}
function issueOfflineLease({user,sessionId,expiresAt,devicePublicKey,privateKey,now=Date.now()}) {
  const accountId=user?.role==='STUDENT'?user?.studentAccountId:user?.userId;
  if (!user || !ROLES.has(user.role) || user.mustChangePassword || !user.schoolId || !accountId || !sessionId)
    throw new LeaseError(403,'This account is not eligible for offline authorization.');
  const sessionEnd=Date.parse(expiresAt);
  if (!Number.isSafeInteger(now) || !Number.isFinite(sessionEnd) || sessionEnd<=now)
    throw new LeaseError(401,'The online session is expired.');
  const device=deviceKey(devicePublicKey);
  const issuer=signingKey(privateKey);
  const publicKey=createPublicKey(issuer);
  const claims={
    v:1,aud:audience,role:user.role,schoolId:String(user.schoolId),accountId:String(accountId),
    departmentId:user.departmentId==null?null:String(user.departmentId),
    device:thumbprint(device),epoch:createHash('sha256').update('attendigo-offline-session-v1:'+String(sessionId)).digest('base64url'),
    issuedAt:now,expiresAt:Math.min(now+MAX_MS,sessionEnd),kid:thumbprint(publicKey)
  };
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=sign('sha256',Buffer.from(payload),{key:issuer,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return {payload,signature,issuerPublicKey:publicKey.export({format:'jwk'})};
}
// Testable verification primitive. Callers must supply a previously trusted issuer,
// the expected local account and device key, and a durable last-observed time.
function verifyOfflineLease({lease,trustedIssuer,expected,devicePublicKey,now=Date.now(),lastObservedAt}) {
  try {
    if (!lease || !expected || !Number.isSafeInteger(now) || !Number.isSafeInteger(lastObservedAt) ||
        now<lastObservedAt || typeof lease.payload!=='string' || lease.payload.length>4096 ||
        !/^[A-Za-z0-9_-]+$/.test(lease.payload) || !/^[A-Za-z0-9_-]{86}$/.test(lease.signature)) return null;
    const issuer=deviceKey(trustedIssuer), device=deviceKey(devicePublicKey);
    if (!verify('sha256',Buffer.from(lease.payload),{key:issuer,dsaEncoding:'ieee-p1363'},Buffer.from(lease.signature,'base64url'))) return null;
    const c=JSON.parse(Buffer.from(lease.payload,'base64url').toString('utf8'));
    if (c.v!==1 || c.aud!==audience || !ROLES.has(c.role) || c.kid!==thumbprint(issuer) ||
        c.device!==thumbprint(device) || c.role!==expected.role || c.schoolId!==String(expected.schoolId) ||
        c.accountId!==String(expected.accountId) || !expected.epoch || c.epoch!==expected.epoch ||
        !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) || c.issuedAt>now ||
        c.expiresAt<=now || c.expiresAt<=c.issuedAt || c.expiresAt-c.issuedAt>MAX_MS) return null;
    return c;
  } catch { return null; }
}
module.exports={issueOfflineLease,verifyOfflineLease,LeaseError,MAX_MS};
