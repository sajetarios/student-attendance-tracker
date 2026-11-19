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
function pdfEscape(s){return s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function pdfBytes(lines){
 const commands=['BT','/F1 10 Tf','50 760 Td'];
 for(const [i,line] of lines.entries()){
  if(i)commands.push('0 -22 Td');
  commands.push('('+pdfEscape(line)+') Tj');
 }
 commands.push('ET');
 const stream=commands.join('\n')+'\n';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream'
 ];
 let result='%PDF-1.4\n', offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(result));result+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=Buffer.byteLength(result);
 result+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(const offset of offsets.slice(1))result+=String(offset).padStart(10,'0')+' 00000 n \n';
 result+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return Buffer.from(result);
}
test('PDF loader reads a searchable PDF file, not just a text fixture',async()=>{
 const file=pdfBytes(sample.split('\n'));
 const r=await parseSf1PdfBase64(file.toString('base64'));
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
