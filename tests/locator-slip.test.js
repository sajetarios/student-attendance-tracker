'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildLocatorSlip,TEMPLATE_SHA}=require('../locator-slip');
const {createHash}=require('node:crypto');
const data={staffName:'Maria Dela Cruz',position:'Teacher III',schoolName:'Sample National High School',purpose:'Submission of school reports',destination:'Schools Division Office',startsAt:'2026-11-26T08:00:00+08:00',endsAt:'2026-11-26T12:00:00+08:00'};
test('rejects altered or unverified source PDF',()=>{
 assert.throws(()=>buildLocatorSlip(Buffer.from('%PDF-1.6'),data),/integrity/);
});
test('OB PDF endpoint is role and tenant scoped and private',()=>{
 const routes=fs.readFileSync('staff-ob-routes.js','utf8');
 const source=routes.slice(routes.indexOf("app.get('/api/staff-attendance/official-business/:id/locator-slip'"),routes.indexOf("app.get('/api/principal/ob-approvals'"));
 assert.match(source,/requireSchoolRoles\('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'\)/);
 assert.match(source,/o\.school_id=\$1 AND o\.request_id=\$2/);
 assert.match(source,/o\.staff_user_id=\$3 OR \$4='PRINCIPAL'/);
 assert.match(source,/o\.status IN \('PENDING_ADMIN','APPROVED'\)/);
 assert.match(source,/o\.status='PENDING_HEAD' AND u\.role='DEPARTMENT_HEAD'/);
 assert.match(source,/no-store, private/);
 assert.match(source,/res\.send\(pdf\)/);
});
test('actual Annex E PDF remains byte-for-byte intact before appended overlay',{skip:!process.env.ATTENDIGO_LOCATOR_TEMPLATE_PATH},()=>{
 const original=fs.readFileSync(process.env.ATTENDIGO_LOCATOR_TEMPLATE_PATH);
 assert.equal(createHash('sha256').update(original).digest('hex'),TEMPLATE_SHA);
 const filled=buildLocatorSlip(original,data);
 assert.deepEqual(filled.subarray(0,original.length),original);
 assert.ok(filled.length>original.length);
 const overlay=filled.subarray(original.length).toString('ascii');
 assert.ok(overlay.includes(Buffer.from(data.staffName).toString('hex')));
 assert.ok(overlay.includes('/OBF'));
 assert.throws(()=>buildLocatorSlip(original,{...data,endsAt:'2026-11-27T12:00:00+08:00'}),/Travel Authority/);
 assert.throws(()=>buildLocatorSlip(original,{...data,position:''}),/position\/designation/);
 assert.throws(()=>buildLocatorSlip(original,{...data,purpose:'word '.repeat(1000)}),/too long/);
});
