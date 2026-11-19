'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseSf1PdfText,parseSf1PdfBase64}=require('../sf1-pdf-parser');

const sample=[
 'School Form 1 (SF1) School Register',
 'School Year: 2026-2027   Grade Level: 8   Section: RIZAL',
 'LRN NAME Sex (M/F) Address',
 '123456789012 DELA CRUZ, JUAN, SANTOS M Some Address',
 '123456789013 REYES, ANA, MARIA F Some Address'
].join('\n');

test('PDF SF1 extracts only necessary learner fields and keeps section unassigned',()=>{
 const r=parseSf1PdfText(sample);
 assert.equal(r.gradeLevel,'Grade 8');
 assert.equal(r.schoolYear,'2026-2027');
 assert.equal(r.learners.length,2);
 assert.deepEqual(r.learners.map(x=>x.sex),['MALE','FEMALE']);
 assert.deepEqual(r.learners.map(x=>x.fullName),['JUAN SANTOS DELA CRUZ','ANA MARIA REYES']);
 assert.ok(r.learners.every(x=>x.section==='Unassigned'&&!('address' in x)));
 assert.deepEqual(r.errors,[]);
});
test('PDF SF1 rejects unsupported layouts instead of speculatively creating learners',()=>{
 assert.throws(()=>parseSf1PdfText('123456789012'),/selectable text/);
 assert.throws(()=>parseSf1PdfText('not sf1 '+sample.replace(/School Form 1 \(SF1\)/,'some form').replace(/School Register/,'generic form').replace(/LRN NAME/,'ID STUDENT')),/does not appear/);
 const partial=sample.replace('REYES, ANA, MARIA F','REYES, ANA, MARIA UNKNOWN');
 const result=parseSf1PdfText(partial);
 assert.equal(result.learners.length,1);
 assert.equal(result.errors.length,1);
});
// Searchable, standards-compliant PDF fixture generated with ReportLab (synthetic learner data).
const searchablePdfBase64='JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA5MDAgOTAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMTE5MDY1MDE5KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYxMTE5MDY1MDE5KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovTGVuZ3RoIDQyMAo+PgpzdHJlYW0KMSAwIDAgMSAwIDAgY20gIEJUIC9GMSAxMiBUZiAxNC40IFRMIEVUCkJUIDEgMCAwIDEgNTAgODAwIFRtIChTY2hvb2wgRm9ybSAxIFwoU0YxXCkgU2Nob29sIFJlZ2lzdGVyKSBUaiBUKiBFVApCVCAxIDAgMCAxIDUwIDc3OCBUbSAoU2Nob29sIFllYXI6IDIwMjYtMjAyNyBHcmFkZSBMZXZlbDogOCBTZWN0aW9uOiBSSVpBTCkgVGogVCogRVQKQlQgMSAwIDAgMSA1MCA3NTYgVG0gKExSTiBOQU1FIFNleCBcKE0vRlwpIEFkZHJlc3MpIFRqIFQqIEVUCkJUIDEgMCAwIDEgNTAgNzM0IFRtICgxMjM0NTY3ODkwMTIgREVMQSBDUlVaLCBKVUFOLCBTQU5UT1MgTSBTb21lIEFkZHJlc3MpIFRqIFQqIEVUCkJUIDEgMCAwIDEgNTAgNzEyIFRtICgxMjM0NTY3ODkwMTMgUkVZRVMsIEFOQSwgTUFSSUEgRiBTb21lIEFkZHJlc3MpIFRqIFQqIEVUCiAKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDA5MiAwMDAwMCBuIAowMDAwMDAwMTk5IDAwMDAwIG4gCjAwMDAwMDAzOTIgMDAwMDAgbiAKMDAwMDAwMDQ2MCAwMDAwMCBuIAowMDAwMDAwNzIxIDAwMDAwIG4gCjAwMDAwMDA3ODAgMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8YTJjMDFkZGM0NzNjMmUyNGUwNzQ2MTBjNjZkZjhmMmU+PGEyYzAxZGRjNDczYzJlMjRlMDc0NjEwYzY2ZGY4ZjJlPl0KJSBSZXBvcnRMYWIgZ2VuZXJhdGVkIFBERiBkb2N1bWVudCAtLSBkaWdlc3QgKG9wZW5zb3VyY2UpCgovSW5mbyA1IDAgUgovUm9vdCA0IDAgUgovU2l6ZSA4Cj4+CnN0YXJ0eHJlZgoxMjUwCiUlRU9GCg==';
test('PDF loader reads a searchable PDF file, not just a text fixture',async()=>{
 const r=await parseSf1PdfBase64(searchablePdfBase64);
 assert.equal(r.learners.length,2);
 assert.equal(r.learners[0].lrn,'123456789012');
});
test('PDF loader rejects a fake PDF and oversized upload',async()=>{
 await assert.rejects(parseSf1PdfBase64(Buffer.from('not pdf!').toString('base64')),/valid PDF/);
 await assert.rejects(parseSf1PdfBase64(Buffer.alloc(5*1024*1024+1,1).toString('base64')),/valid PDF/);
});
test('SF1 routes and portal accept PDF only within SF1 flow',()=>{
 const root=path.join(__dirname,'..');
 const routes=fs.readFileSync(path.join(root,'sf1-import-routes.js'),'utf8');
 const portal=fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
 assert.match(routes,/parseSf1PdfBase64/);
 assert.match(portal,/fileType:'pdf'/);
 assert.match(portal,/ext==='pdf'/);
 assert.match(html,/searchable PDF/);
});
