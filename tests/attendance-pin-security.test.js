'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validAttendancePin,hashAttendancePin,verifyAttendancePin}=require('../attendance-pin-security');
test('attendance PIN accepts exactly six ASCII digits',()=>{
 assert.equal(validAttendancePin('012345'),true);
 for(const value of ['12345','1234567','abcdef','１２３４５６',123456,'12 456',null])assert.equal(validAttendancePin(value),false);
});
test('attendance PIN is salted, not stored as plaintext, and verified',async()=>{
 const a=await hashAttendancePin('012345'),b=await hashAttendancePin('012345');
 assert.notEqual(a,b);
 assert.equal(a.includes('012345'),false);
 assert.equal(await verifyAttendancePin('012345',a),true);
 assert.equal(await verifyAttendancePin('999999',a),false);
 assert.equal(await verifyAttendancePin('012345','invalid'),false);
});
test('invalid PIN input is rejected',async()=>{
 await assert.rejects(hashAttendancePin('12345'),/six digits/);
 assert.equal(await verifyAttendancePin('12345','invalid'),false);
});
