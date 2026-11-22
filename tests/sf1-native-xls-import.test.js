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

test('actual LIS layout: 3 male + 25 female + numeric COMBINED total is 28 learners, not a bad LRN',async()=>{
  // All records are synthetic; never commit or expose an actual learner roster.
  const rows=[
    ['School Form 1 (SF 1) School Register'],
    ['School Year: 2026 - 2027','Grade Level: Grade 8 (Year II)'],
    ['LRN', '', 'NAME\n(Last Name, First Name, Middle Name)', '', '', '', 'Sex (M/F)']
  ];
  for(let i=0;i<3;i++)rows.push([129000000001+i,'','MALE, LEARNER'+(i+1)+', SAMPLE','','','','M']);
  rows.push([3,'','<=== TOTAL MALE']);
  for(let i=0;i<25;i++)rows.push([129000000004+i,'','FEMALE, LEARNER'+(i+1)+', SAMPLE','','','','F']);
  rows.push([25,'','<=== TOTAL FEMALE']);
  rows.push([28,'','<=== COMBINED']);
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'School Form 1');
  const base64=XLSX.write(workbook,{bookType:'biff8',type:'base64'});
  const result=await parseSf1Base64(base64,'xls');
  assert.equal(result.gradeLevel,'Grade 8');
  assert.equal(result.schoolYear,'2026-2027');
  assert.equal(result.learners.length,28);
  assert.equal(result.learners.filter(x=>x.sex==='MALE').length,3);
  assert.equal(result.learners.filter(x=>x.sex==='FEMALE').length,25);
  assert.deepEqual(result.errors,[]);
  assert.ok(result.learners.every(x=>/^\d{12}$/.test(x.lrn) && x.section==='Unassigned'));
  // A genuinely malformed learner LRN must not be silently accepted.
  rows.splice(4,0,[4567,'','INVALID, LEARNER, SAMPLE','','','','M']);
  const invalid=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(invalid,XLSX.utils.aoa_to_sheet(rows),'School Form 1');
  const bad=await parseSf1Base64(XLSX.write(invalid,{bookType:'biff8',type:'base64'}),'xls');
  assert.ok(bad.errors.some(x=>/Invalid 12-digit LRN/.test(x.message)));
});

test('SF1 preview displays row-specific validation reasons rather than a generic failure',()=>{
  const root=path.join(__dirname,'..');
  const portal=fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
  assert.match(portal,/error\.details=data\.details\.slice\(0,25\)/);
  assert.match(portal,/failedRows\.map\(issue=>/);
  assert.match(portal,/esc\(issue\.rowNumber/);
  assert.match(portal,/esc\(issue\.message/);
});


test('actual LIS two-tier parent headings preserve source family names but never invent guardians',()=>{
  // Synthetic values with the exact wide-column header structure from an official LIS export.
  const rows=Array.from({length:7},()=>Array(45).fill(''));
  rows[0][0]='School Form 1 (SF 1) School Register';
  rows[3][19]='2026 - 2027'; rows[3][30]='Grade 8 (Year II)';
  Object.assign(rows[4],{
    0:'LRN',2:'NAME\n(Last Name, First Name, Middle Name)',6:'Sex (M/F)',
    7:'BIRTH DATE\n(mm/dd/yyyy)',15:'ADDRESS',27:'PARENTS',
    36:'GUARDIAN\n(if Not Parent)',41:'Contact Number of Parent or Guardian'
  });
  Object.assign(rows[5],{
    15:'House #/ Street/ Sitio/ Purok',17:'Barangay',
    20:'Municipality/ City',22:'Province',
    27:"Father's Name (Last Name, First Name, Middle Name)     ",
    31:"Mother's Maiden Name (Last Name, First Name, Middle Name)",
    36:'Name',40:'Relationship'
  });
  Object.assign(rows[6],{
    0:129380180009,2:'SANTOS, MARIA, REYES',6:'F',7:41430,
    17:'CENTRAL',20:'MATI',22:'DAVAO ORIENTAL',
    27:'SANTOS, JOSE RAMON',31:'REYES, ANA, LUNA,'
  });
  const parsed=require('../sf1-import-parser').parseSf1Matrix(rows);
  assert.equal(parsed.learners.length,1);
  const learner=parsed.learners[0];
  assert.equal(learner.fatherName,'SANTOS, JOSE RAMON');
  assert.equal(learner.motherMaidenName,'REYES, ANA, LUNA');
  assert.equal(learner.sf1GuardianName,'');
  assert.equal(learner.parentName,'');
  assert.equal(learner.parentMobile,'');
  assert.equal(learner.birthDate,'2013-06-05');
  assert.match(learner.sf1Address,/MATI/);
});
test('SF1 preview displays source values and explicit blanks even when learner is newly created',()=>{
  const portal=fs.readFileSync(path.join(__dirname,'..','public/portal.js'),'utf8');
  assert.match(portal,/const sf1SourceKeys=\['fatherName','motherMaidenName','sf1GuardianName'/);
  assert.match(portal,/const sourceFields=match\?fields:sf1SourceKeys/);
  assert.match(portal,/Not provided in SF1/);
  assert.match(portal,/parents are never automatically designated as legal guardians/);
  assert.match(portal,/detectedSourceCount/);
});
