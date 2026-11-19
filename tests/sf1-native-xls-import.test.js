'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('@stackline/xlsx');
const {parseSf1Base64} = require('../sf1-import-parser');

function createLisBiff8Fixture() {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['School Form 1 (SF 1) School Register'],
    ['(This replaces Form 1, Master List...)'],
    ['School ID', '', '', '', '', '', '', '', '', '', 'Region XI'],
    ['School Name', '', '', '', '', 'Sample High School', '', '', '', '',
      '', '', '', '', '', '', 'School Year', '', '', '2026 - 2027',
      '', '', '', '', '', 'Grade Level', '', '', '', '', 'Grade 8 (Year II)'],
    ['LRN', '', 'NAME (Last Name, First Name, Middle Name)', '', '', '', 'Sex (M/F)'],
    [],
    [129380180009, '', 'SANTOS,JOHN, REYES', '', '', '', 'M'],
    [129453180016, '', 'CRUZ,MARIA, DIAZ', '', '', '', 'F'],
    ['', '', '<=== TOTAL MALE'],
    ['', '', '<=== TOTAL FEMALE']
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'School Form 1');
  return XLSX.write(workbook,{type:'buffer',bookType:'biff8'});
}

test('official LIS-style BIFF8 .xls yields LRN, name, sex and grade, not private extras', async () => {
  const data = createLisBiff8Fixture();
  assert.deepEqual([...data.subarray(0,8)],[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
  const result = await parseSf1Base64(data.toString('base64'),'xls');
  assert.equal(result.schoolYear,'2026-2027');
  assert.equal(result.gradeLevel,'Grade 8');
  assert.deepEqual(result.learners.map(({lrn,sex})=>({lrn,sex})),[
    {lrn:'129380180009',sex:'MALE'},
    {lrn:'129453180016',sex:'FEMALE'}
  ]);
  assert.equal(result.learners[0].fullName,'JOHN REYES SANTOS');
  assert.deepEqual(result.errors,[]);
  assert.ok(result.learners.every(row=>row.section==='Unassigned'&&row.studentId===''&&!('address' in row)));
});

test('xls is accepted by extension and rejected if content is spoofed', async () => {
  const legacy=createLisBiff8Fixture();
  await assert.rejects(parseSf1Base64(legacy.toString('base64'),'xlsx'),/not a valid .xlsx/i);
  await assert.rejects(parseSf1Base64(Buffer.from('not an excel workbook').toString('base64'),'xls'),/not a genuine Excel .xls/i);
  await assert.rejects(parseSf1Base64(Buffer.alloc(5*1024*1024+1).toString('base64'),'xls'),/5 MB or smaller/i);
});

test('live import UI and API select native xls only in SF1 mode, retain duplicate safeguards', () => {
  const root=path.join(__dirname,'..');
  const js=fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
  const routes=fs.readFileSync(path.join(root,'sf1-import-routes.js'),'utf8');
  assert.match(html,/\.xls or \.xlsx/);
  assert.match(js,/fileType:'xls'/);
  assert.match(js,/\['xls','xlsx','pdf'\]/);
  assert.match(js,/\['csv','xlsx'\]/);
  assert.match(routes,/parseSf1Base64\(req\.body\?\.fileBase64,req\.body\?\.fileType/);
  assert.match(routes,/Duplicate LRNs found/);
  assert.match(routes,/pg_advisory_xact_lock/);
  assert.match(routes,/nextStudentId\(client/);
  assert.match(routes,/student_enrollments/);
});
