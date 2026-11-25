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
test('actual Annex E content is preserved and stale linearization is disabled',{skip:!fs.existsSync(master)},()=>{
 const original=fs.readFileSync(master);
 assert.equal(createHash('sha256').update(original).digest('hex'),TEMPLATE_SHA);
 const filled=buildLocatorSlip(original,data);
 const expected=Buffer.from(original);
 const hint=expected.indexOf('/Linearized');assert.ok(hint>=0&&hint<128);
 expected.write('/ObOrigHint',hint,'ascii');
 assert.deepEqual(filled.subarray(0,original.length),expected);
 assert.equal(createHash('sha256').update(original).digest('hex'),TEMPLATE_SHA);
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
 for(const page of ['public/portal.html','public/principal.html','public/sw.js']) assert.match(fs.readFileSync(page,'utf8'),/\/locator-slip-ui\.js\?v=4/);
});

test('in-app preview and iOS sharing are independent of native PDF navigation',()=>{
 const ui=fs.readFileSync('public/locator-slip-ui.js','utf8');
 const routes=fs.readFileSync('staff-ob-routes.js','utf8');
 assert.match(ui,/preview\.src=url\+'\?preview=1'/);
 assert.match(ui,/navigator\.share\(\{files:\[file\]\}\)/);
 assert.match(ui,/preview\.onerror=/);
 assert.match(routes,/req\.query\?\.preview==='1'/);
 assert.match(routes,/renderLocatorPreview\(pdf\)/);
 assert.match(routes,/res\.set\('Content-Type','image\/png'\)/);
});
test('PDF.js can render a real one-page PDF to a PNG in Node',async()=>{
 const {renderLocatorPreview}=require('../locator-slip-preview');
 // Exercise the actual renderer without relying on an external PDF download.
 const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> /Contents 4 0 R >>','<< /Length 25 >>\nstream\n0 0 1 rg 10 10 50 50 re f\nendstream'];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<bodies.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+bodies[i]+'\nendobj\n';}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n';for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \n';
 pdf+='trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 const png=await renderLocatorPreview(Buffer.from(pdf,'ascii'));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),330);
 assert.equal(png.readUInt32BE(20),495);
});
test('render the actual generated Locator Slip when the official master is available',{skip:!fs.existsSync(master)},async()=>{
 const {renderLocatorPreview}=require('../locator-slip-preview');
 const png=await renderLocatorPreview(buildLocatorSlip(fs.readFileSync(master),data));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.ok(png.length>10000);
});

test('print PDF has one fresh xref, lossless RGB and correct page size',()=>{
 const {buildPrintPdf}=require('../locator-slip-print-pdf');
 const {inflateSync}=require('node:zlib');
 const rgb=Buffer.from([255,255,255,10,20,30,40,50,60,255,0,0]);
 const pdf=buildPrintPdf({rgb,width:2,height:2,pageWidth:595.44,pageHeight:841.68});
 const text=pdf.toString('latin1');
 assert.match(text,/^%PDF-1\.4/);
 assert.match(text,/\/MediaBox \[0 0 595\.4400 841\.6800\]/);
 assert.doesNotMatch(text,/\/Prev |\/Linearized/);
 const xref=Number(text.match(/startxref\n(\d+)/)[1]);
 assert.equal(text.slice(xref,xref+4),'xref');
 const entries=text.slice(xref).split('\n').slice(3,8);
 entries.forEach((line,i)=>assert.ok(text.startsWith((i+1)+' 0 obj',Number(line.slice(0,10)))));
 const imageStart=text.indexOf('stream\n',text.indexOf('4 0 obj'))+7;
 const length=Number(text.slice(text.indexOf('4 0 obj'),imageStart).match(/\/Length (\d+)/)[1]);
 assert.deepEqual(inflateSync(pdf.subarray(imageStart,imageStart+length)),rgb);
});
test('download and native share receive freshly rendered print PDF, not incremental master overlay',()=>{
 const routes=fs.readFileSync('staff-ob-routes.js','utf8');
 assert.match(routes,/pdf=await require\('\.\/locator-slip-preview'\)\.renderLocatorPrintPdf\(pdf\)/);
});
test('actual official print PDF opens as a single nonblank page',{skip:!fs.existsSync(master)},async()=>{
 const {renderLocatorPrintPdf,renderLocatorPreview}=require('../locator-slip-preview');
 const source=buildLocatorSlip(fs.readFileSync(master),data);
 const printed=await renderLocatorPrintPdf(source);
 assert.ok(printed.length>10000);
 const preview=await renderLocatorPreview(printed);
 assert.ok(preview.length>10000);
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(printed),verbosity:0});
 try{const doc=await task.promise;assert.equal(doc.numPages,1);const page=await doc.getPage(1);assert.ok(Math.abs(page.view[2]-595.44)<0.01);assert.ok(Math.abs(page.view[3]-841.68)<0.01);}
 finally{await task.destroy();}
});
