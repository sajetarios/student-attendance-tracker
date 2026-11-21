'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {parseSf1Matrix,normalizeGuardianContact}=require('../sf1-import-parser');
const {parseSf1PdfText}=require('../sf1-pdf-parser');
const {registerSf1ImportRoutes}=require('../sf1-import-routes');

const rows=[
 ['School Form 1 (SF1) School Register'],
 ['School Year: 2026-2027','Grade Level: 8'],
 ['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)','Name of Parent/Guardian','Contact Number'],
 ['123456789012','DELA CRUZ, JUAN, SANTOS','M','MARIA DELA CRUZ','+63 912 345 6789']
];
async function fixture(){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('School Form 1');
 rows.forEach(row=>sheet.addRow(row));
 return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
}
const learner={lrn:'123456789012',student_id:'2026-G8-001',full_name:'JUAN SANTOS DELA CRUZ',sex:'MALE',parent_name:'',parent_mobile:'',active:true,archived_at:null};
function createHarness(existing=[learner]){
 const calls=[],endpoints={};
 const query=async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('FROM school_years WHERE'))return {rowCount:1,rows:[{school_year_id:'year-test',school_year_label:'2026-2027'}]};
  if(sql.includes('school_offers_grade'))return {rowCount:1,rows:[{allowed:true}]};
  if(sql.includes('FROM students WHERE school_id=$1 AND (lrn=ANY'))return {rowCount:existing.length,rows:existing};
  if(sql.includes('UPDATE students'))return {rowCount:1,rows:[{student_id:params[1]}]};
  return {rowCount:1,rows:[]};
 };
 const client={query,release(){}};
 const pool={query,connect:async()=>client};
 const app={post:(path,...handlers)=>{endpoints[path]=handlers.at(-1);}};
 registerSf1ImportRoutes(app,pool,{authenticateSchoolClient:(req,res,next)=>next(),requireSchoolRoles:()=>((req,res,next)=>next())});
 const invoke=async(route,body)=>{
  const req={body,auth:{role:'SCHOOL_ADMIN',schoolId:'school-test',userId:'admin-test'}};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  await endpoints[route](req,res);return res;
 };
 return {invoke,calls};
}

test('SF1 Excel captures labeled guardian and contact fields and normalizes Philippine numbers',()=>{
 const result=parseSf1Matrix(rows);
 assert.equal(result.learners[0].lrn,'123456789012');
 assert.equal(result.learners[0].parentName,'MARIA DELA CRUZ');
 assert.equal(result.learners[0].parentMobile,'09123456789');
 assert.equal(normalizeGuardianContact('9123456789'),'09123456789');
 assert.equal(normalizeGuardianContact('not-a-number'),null);
 const noExtras=rows.map(row=>row.slice(0,3));
 assert.equal(parseSf1Matrix(noExtras).learners[0].parentName,'');
 assert.equal(parseSf1Matrix(noExtras).learners[0].parentMobile,'');
});

test('invalid or ambiguous guardian phone produces explicit row validation error',()=>{
 const invalid=rows.map(row=>[...row]);invalid[3][4]='0912 / 0999';
 // An entirely invalid roster must fail without importing partial data.
 assert.throws(()=>parseSf1Matrix(invalid),/No valid SF1 learners/);
});

test('searchable PDF with explicit SF1 table separators maps guardian columns',()=>{
 const text=['School Form 1 (SF1) School Register',
  'School Year: 2026-2027 Grade Level: 8',
  'LRN | NAME (Last Name, First Name, Middle Name) | Sex (M/F) | Name of Parent/Guardian | Contact Number',
  '123456789012 | DELA CRUZ, JUAN, SANTOS | M | MARIA DELA CRUZ | 09123456789'
 ].join('\n');
 const parsed=parseSf1PdfText(text);
 assert.equal(parsed.learners[0].parentName,'MARIA DELA CRUZ');
 assert.equal(parsed.learners[0].parentMobile,'09123456789');
});

test('SF1 review previews and safely fills only previously empty guardian fields',async()=>{
 const data=await fixture(),h=createHarness();
 const payload={fileBase64:data,fileType:'xlsx'};
 const preview=await h.invoke('/api/students/sf1/preview',payload);
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.summary.create,0);
 assert.equal(preview.body.summary.update,1);
 assert.equal(preview.body.rows[0].existingStudent.studentId,'2026-G8-001');
 assert.equal(Object.hasOwn(preview.body.rows[0].existingStudent,'parentName'),false);
 assert.equal(Object.hasOwn(preview.body.rows[0].existingStudent,'parentMobile'),false);
 const commit=await h.invoke('/api/students/sf1/commit',payload);
 assert.equal(commit.statusCode,200);
 assert.equal(commit.body.updated,1);
 assert.equal(commit.body.created,0);
 const updates=h.calls.filter(c=>c.sql.includes('UPDATE students'));
 assert.equal(updates.length,1);
 assert.deepEqual(updates[0].params.slice(2,5),['123456789012','MARIA DELA CRUZ','09123456789']);
 assert.match(updates[0].sql,/NULLIF\(BTRIM\(parent_name\)/);
 assert.doesNotMatch(updates[0].sql,/SET\s+lrn\s*=|SET\s+full_name\s*=|UPDATE\s+student_enrollments/i);
 assert.equal(h.calls.filter(c=>/DELETE FROM|UPDATE attendance|UPDATE student_enrollments/i.test(c.sql)).length,0);
});

test('existing guardian conflict or ambiguous name forces review and blocks commit',async()=>{
 const data=await fixture(),payload={fileBase64:data,fileType:'xlsx',recoverMissingLrn:false};
 const conflict=createHarness([{...learner,parent_name:'ANOTHER GUARDIAN'}]);
 const preview=await conflict.invoke('/api/students/sf1/preview',payload);
 assert.equal(preview.body.summary.review,1);
 assert.match(preview.body.rows[0].errors.join(' '),/conflicts/);
 const commit=await conflict.invoke('/api/students/sf1/commit',payload);
 assert.equal(commit.statusCode,409);
 assert.equal(conflict.calls.filter(c=>c.sql.includes('UPDATE students')).length,0);
 const missingLrn=createHarness([{...learner,lrn:null,grade_level:'Grade 8'}]);
 const duplicate=await missingLrn.invoke('/api/students/sf1/preview',payload);
 assert.equal(duplicate.body.summary.review,1);
 assert.equal(duplicate.body.summary.create,0);
});

test('saved identity, attendance and permission controls remain protected',()=>{
 const fs=require('node:fs');
 const root=require('node:path').join(__dirname,'..');
 const routes=fs.readFileSync(require('node:path').join(root,'sf1-import-routes.js'),'utf8');
 const portal=fs.readFileSync(require('node:path').join(root,'public/portal.js'),'utf8');
 const html=fs.readFileSync(require('node:path').join(root,'public/portal.html'),'utf8');
 assert.match(routes,/pg_advisory_xact_lock/);
 assert.match(routes,/class_adviser_assignments/);
 assert.match(routes,/requireSchoolRoles\('SCHOOL_ADMIN','TEACHER'\)/);
 assert.match(routes,/STUDENT_SF1_IMPORT/);
 assert.match(portal,/Complete missing profile/);
 assert.match(html,/Parent \/ Guardian/);
 assert.match(html,/Contact<\/th>/);
});

test('opt-in LRN recovery fills only a uniquely matched blank LRN and preserves enrollment and attendance',async()=>{
 const data=await fixture(),h=createHarness([{...learner,lrn:null,grade_level:'Grade 8'}]);
 const base={fileBase64:data,fileType:'xlsx',recoverMissingLrn:false};
 const without=await h.invoke('/api/students/sf1/preview',base);
 assert.equal(without.body.summary.review,1);
 const payload={...base,recoverMissingLrn:true};
 const preview=await h.invoke('/api/students/sf1/preview',payload);
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.summary.recover,1);
 assert.equal(preview.body.rows[0].action,'RECOVER');
 assert.equal(preview.body.rows[0].existingStudent.studentId,'2026-G8-001');
 const result=await h.invoke('/api/students/sf1/commit',payload);
 assert.equal(result.statusCode,200);
 assert.equal(result.body.recovered,1);
 assert.equal(result.body.created,0);
 const updates=h.calls.filter(c=>c.sql.includes('UPDATE students'));
 assert.equal(updates.length,1);
 assert.match(updates[0].sql,/SET lrn=\$3/);
 assert.match(updates[0].sql,/NULLIF\(BTRIM\(lrn\)/);
 assert.equal(h.calls.filter(c=>/DELETE FROM|UPDATE attendance|UPDATE student_enrollments/i.test(c.sql)).length,0);
});
test('LRN recovery blocks duplicate-name matches, sex differences and existing nonblank LRNs',async()=>{
 const data=await fixture(),payload={fileBase64:data,fileType:'xlsx',recoverMissingLrn:true};
 for(const records of [
  [{...learner,lrn:null,grade_level:'Grade 8',sex:'FEMALE'}],
  [{...learner,lrn:'999999999999',grade_level:'Grade 8'}],
  [{...learner,lrn:null,grade_level:'Grade 8'},{...learner,student_id:'2026-G8-002',lrn:null,grade_level:'Grade 8'}]
 ]){
  const h=createHarness(records),preview=await h.invoke('/api/students/sf1/preview',payload);
  assert.equal(preview.body.summary.review,1);
  const commit=await h.invoke('/api/students/sf1/commit',payload);
  assert.equal(commit.statusCode,409);
  assert.equal(h.calls.filter(c=>c.sql.includes('UPDATE students')).length,0);
 }
});

test('official LIS SF1 separately maps father, mother, guardian, birth and address',()=>{
 const sheet=[
  ['School Form 1 (SF1) School Register'],
  ['School Year: 2026-2027','Grade Level: 8'],
  ['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)','Birth Date','Father Name','Mother Maiden Name','Guardian Name (If Not Parent)','Contact Number of Parent or Guardian','House / Street / Sitio / Purok','Barangay','City / Municipality','Province'],
  ['123456789012','DELA CRUZ, JUAN, SANTOS','M','06/05/2013','JOSE DELA CRUZ','MARIA SANTOS','TITA DELA CRUZ','09123456789','ZONE 3','SAN ROQUE','MATI','DAVAO ORIENTAL']
 ];
 const one=parseSf1Matrix(sheet).learners[0];
 assert.equal(one.fatherName,'JOSE DELA CRUZ');
 assert.equal(one.motherMaidenName,'MARIA SANTOS');
 assert.equal(one.sf1GuardianName,'TITA DELA CRUZ');
 assert.equal(one.birthDate,'2013-06-05');
 assert.match(one.sf1Address,/SAN ROQUE/);
 assert.equal(one.parentName,'');
 assert.equal(one.parentMobile,'09123456789');
});
test('the unified SF1 import fills missing family information without altering identifiers or attendance',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('SF1');
 [
 ['School Form 1 (SF1) School Register'],['School Year: 2026-2027','Grade Level: 8'],
 ['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)','Father Name','Mother Maiden Name','Guardian Name','Contact Number'],
 ['123456789012','DELA CRUZ, JUAN, SANTOS','M','JOSE DELA CRUZ','MARIA SANTOS','TITA DELA CRUZ','09123456789']
 ].forEach(x=>sheet.addRow(x));
 const fileBase64=Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
 const h=createHarness([{...learner,grade_level:'Grade 8',father_name:null,mother_maiden_name:null,sf1_guardian_name:null,birth_date:null,sf1_address:null}]);
 const payload={fileType:'xlsx',fileBase64,recoverMissingLrn:true};
 const preview=await h.invoke('/api/students/sf1/preview',payload);
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.summary.update,1);
 assert.deepEqual(preview.body.rows[0].missingFields.sort(),['fatherName','motherMaidenName','parentMobile','sf1GuardianName'].sort());
 const commit=await h.invoke('/api/students/sf1/commit',payload);
 assert.equal(commit.statusCode,200);
 const updates=h.calls.filter(c=>c.sql.includes('UPDATE students'));
 assert.equal(updates.length,1);
 assert.match(updates[0].sql,/father_name=COALESCE/);
 assert.match(updates[0].sql,/mother_maiden_name=COALESCE/);
 assert.match(updates[0].sql,/sf1_guardian_name=COALESCE/);
 assert.equal(h.calls.filter(c=>/DELETE FROM|UPDATE attendance|UPDATE student_enrollments/i.test(c.sql)).length,0);
});


test('official LIS SF1 two-row merged header layout reads family fields and Excel serial dates',()=>{
 const row=(pairs)=>{const a=Array(45).fill('');for(const [i,v] of pairs)a[i]=v;return a;};
 const official=[
  row([[0,'School Form 1 (SF 1) School Register']]),
  row([[0,'School Year'],[19,'2026 - 2027'],[25,'Grade Level'],[30,'Grade 8 (Year II)']]),
  row([[0,'LRN'],[2,'NAME\\n(Last Name, First Name, Middle Name)'],[6,'Sex (M/F)'],[7,'BIRTH DATE\\n(mm/dd/yyyy)'],[15,'ADDRESS'],[27,'PARENTS'],[36,'GUARDIAN\\n(if Not Parent)'],[41,'Contact Number of Parent or Guardian']]),
  row([[15,'House #/ Street/ Sitio/ Purok'],[17,'Barangay'],[20,'Municipality/ City'],[22,'Province'],[27,"Father's Name (Last Name, First Name, Middle Name)"],[31,"Mother's Maiden Name (Last Name, First Name, Middle Name)"],[36,'Name']]),
  row([[0,'129380180009'],[2,'NONONG,LANCE JESSE, SOTOMAYOR'],[6,'M'],[7,41430],[17,'CENTRAL (POB.)'],[20,'CITY OF MATI'],[22,'DAVAO ORIENTAL'],[27,'FATHER TEST'],[31,'MOTHER TEST'],[36,'GUARDIAN TEST'],[41,'09123456789']]),
  row([[0,1],[2,'<=== TOTAL MALE']])
 ];
 const parsed=parseSf1Matrix(official);
 assert.equal(parsed.learners.length,1);
 assert.equal(parsed.gradeLevel,'Grade 8');
 assert.equal(parsed.learners[0].birthDate,'2013-06-05');
 assert.equal(parsed.learners[0].fatherName,'FATHER TEST');
 assert.equal(parsed.learners[0].motherMaidenName,'MOTHER TEST');
 assert.equal(parsed.learners[0].sf1GuardianName,'GUARDIAN TEST');
 assert.equal(parsed.learners[0].parentMobile,'09123456789');
 assert.match(parsed.learners[0].sf1Address,/CENTRAL/);
});
