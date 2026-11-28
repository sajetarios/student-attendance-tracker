/* Signed offline lease verification only. Never use this to authorize an
 * online request or reveal a cached dashboard before snapshot validation. */
(()=>{'use strict';
 const MAX_MS=12*60*60*1000;
 const ROLES=new Set(['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']);
 const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 function decode(value,max){
  if(typeof value!=='string'||!value.length||value.length>max||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Malformed lease');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
 }
 function publicJwk(jwk){
  if(!jwk||jwk.kty!=='EC'||jwk.crv!=='P-256'||'d' in jwk||
     !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)||!/^[A-Za-z0-9_-]{43}$/.test(jwk.y))throw Error('Invalid public key');
  const {crv,kty,x,y}=jwk;return {crv,kty,x,y};
 }
 const subtle=()=>crypto.subtle;
 async function thumbprint(jwk){return encode(await subtle().digest('SHA-256',encoder.encode(JSON.stringify(publicJwk(jwk)))));}
 async function importPublic(jwk){return subtle().importKey('jwk',publicJwk(jwk),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);}
 async function createDeviceKey(){
  const pair=await subtle().generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  return {privateKey:pair.privateKey,publicKey:publicJwk(await subtle().exportKey('jwk',pair.publicKey))};
 }
 async function verifyLease({lease,trustedIssuer,expected,device,now=Date.now(),lastObservedAt}){
  try{
   if(!lease||!expected||!Number.isSafeInteger(now)||!Number.isSafeInteger(lastObservedAt)||now<lastObservedAt||
      !device?.privateKey||device.privateKey.type!=='private'||device.privateKey.extractable||
      device.privateKey.algorithm?.name!=='ECDSA'||device.privateKey.algorithm?.namedCurve!=='P-256')return null;
   const payload=decode(lease.payload,4096),signature=decode(lease.signature,86);
   if(signature.length!==64)return null;
   const issuer=await importPublic(trustedIssuer);
   const algorithm={name:'ECDSA',hash:'SHA-256'};
   if(!await subtle().verify(algorithm,issuer,signature,encoder.encode(lease.payload)))return null;
   const c=JSON.parse(decoder.decode(payload));
   if(c.v!==1||c.aud!=='attendigo:offline-dashboard:v1'||!ROLES.has(c.role)||
      c.kid!==await thumbprint(trustedIssuer)||c.device!==await thumbprint(device.publicKey)||
      c.role!==expected.role||c.schoolId!==String(expected.schoolId)||c.accountId!==String(expected.accountId)||
      !Object.hasOwn(expected,'departmentId')||c.departmentId!==(expected.departmentId==null?null:String(expected.departmentId))||
      !expected.epoch||c.epoch!==expected.epoch||
      !Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||
      c.issuedAt>now||c.expiresAt<=now||c.expiresAt<=c.issuedAt||c.expiresAt-c.issuedAt>MAX_MS)return null;
   // A copied lease + public key alone cannot unlock a different browser.
   const challenge=crypto.getRandomValues(new Uint8Array(32));
   const proof=await subtle().sign(algorithm,device.privateKey,challenge);
   if(!await subtle().verify(algorithm,await importPublic(device.publicKey),proof,challenge))return null;
   return c;
  }catch{return null;}
 }
 window.AttendigoOfflineLeaseCrypto=Object.freeze({createDeviceKey,verifyLease,thumbprint});
})();
