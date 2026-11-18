'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const PIN_PATTERN = /^[0-9]{6}$/;
const MAXMEM = 64 * 1024 * 1024;
const params = {N:16384,r:8,p:1,maxmem:MAXMEM};
function validAttendancePin(pin){return typeof pin==='string'&&PIN_PATTERN.test(pin);}
async function hashAttendancePin(pin){
 if(!validAttendancePin(pin))throw new Error('Attendance PIN must contain exactly six digits.');
 const salt=crypto.randomBytes(16);
 const derived=await scrypt(pin,salt,32,params);
 return ['attendance-pin-v1',salt.toString('base64url'),Buffer.from(derived).toString('base64url')].join('$');
}
async function verifyAttendancePin(pin,stored){
 if(!validAttendancePin(pin)||typeof stored!=='string')return false;
 const parts=stored.split('$');
 if(parts.length!==3||parts[0]!=='attendance-pin-v1')return false;
 try{
  const salt=Buffer.from(parts[1],'base64url');
  const expected=Buffer.from(parts[2],'base64url');
  if(salt.length!==16||expected.length!==32)return false;
  const actual=Buffer.from(await scrypt(pin,salt,32,params));
  return crypto.timingSafeEqual(actual,expected);
 }catch{return false;}
}
module.exports={validAttendancePin,hashAttendancePin,verifyAttendancePin};
