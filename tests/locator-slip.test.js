'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildLocatorSlip,TEMPLATE_SHA,installTemplate,getTemplate}=require('../locator-slip');
const path=require('node:path');
const master=process.env.ATTENDIGO_LOCATOR_TEMPLATE_PATH||path.join(__dirname,'../templates/Revised-Annex-E.pdf');
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
test('actual Annex E PDF remains byte-for-byte intact before appended overlay',{skip:!fs.existsSync(master)},()=>{
 const original=fs.readFileSync(master);
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

test('rejects an arbitrary upload before any database write',async()=>{
 let queries=0;
 await assert.rejects(installTemplate({query:async()=>{queries++;}},Buffer.from('not the official file')),/integrity/);
 assert.equal(queries,0);
});
test('master installer is fixed-digest, single-row and does not call the upstream site',()=>{
 const source=fs.readFileSync('locator-slip.js','utf8');
 const migration=fs.readFileSync('migrations/096_shared_locator_slip_template.sql','utf8');
 const routes=fs.readFileSync('staff-ob-routes.js','utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(/);
 assert.match(source,/ON CONFLICT\(template_id\) DO NOTHING/);
 assert.match(migration,/CHECK\(template_id='DEPED_REVISED_ANNEX_E'\)/);
 assert.match(migration,/octet_length\(pdf_bytes\)=109793/);
 assert.match(routes,/express\.raw\(\{type:'application\/pdf',limit:'120kb'\}\)/);
 assert.match(routes,/LOCATOR_TEMPLATE_REQUIRED/);
});
test('both portals prepare the PDF through the shared inline error handler',()=>{
 const ui=fs.readFileSync('public/locator-slip-ui.js','utf8');
 const staff=fs.readFileSync('public/staff-ob-ui.js','utf8');
 const principal=fs.readFileSync('public/principal-dashboard.js','utf8');
 assert.match(ui,/if\(!response\.ok\)throw await responseError\(response\)/);
 assert.match(ui,/LOCATOR_TEMPLATE_REQUIRED/);
 assert.doesNotMatch(ui,/URL\.createObjectURL|\bblob:/);
 assert.match(ui,/link\.href=url/);
 assert.match(ui,/save\.href=url\+'\?download=1'/);
 assert.match(ui,/response\.arrayBuffer\(\)/);
 assert.match(fs.readFileSync('staff-ob-routes.js','utf8'),/req\.query\?\.download==='1'\?'attachment':'inline'/);
 assert.match(staff,/AttendigoLocatorSlip\.attach/);
 assert.match(principal,/AttendigoLocatorSlip\.attach/);
 for(const page of ['public/portal.html','public/principal.html','public/sw.js']) assert.match(fs.readFileSync(page,'utf8'),/\/locator-slip-ui\.js\?v=2/);
});
