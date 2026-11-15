'use strict';const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {localDate,dayOfWeek,at,sign}=require('../class-qr-routes');
test('school date is ISO formatted',()=>assert.match(localDate(),/^\d{4}-\d{2}-\d{2}$/));
test('weekday matches Philippine class schedule',()=>{assert.equal(dayOfWeek('2026-11-16'),1);assert.equal(dayOfWeek('2026-11-15'),0);});
test('class start time uses Philippine timezone',()=>assert.equal(at('2026-11-16','08:00').toISOString(),'2026-11-16T00:00:00.000Z'));
test('QR token binds session and 30-second bucket',()=>{const s=crypto.randomBytes(32).toString('hex');assert.equal(sign(s,'a',42),sign(s,'a',42));assert.notEqual(sign(s,'a',42),sign(s,'a',43));assert.notEqual(sign(s,'a',42),sign(s,'b',42));assert.match(sign(s,'a',42),/^[a-f0-9]{64}$/);});
