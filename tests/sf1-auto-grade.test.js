'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const fs=require('node:fs');
const path=require('node:path');
const {parseSf1Matrix}=require('../sf1-import-parser');
const {parseSf1PdfText}=require('../sf1-pdf-parser');
const {registerSf1ImportRoutes}=require('../sf1-import-routes');

const rows=[
 ['School Form 1 (SF1) School Register'],
 ['School Year: 2026-2027','Grade Level: 8','Section: Tuvera'],
 ['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)'],
 ['123456789012','DELA CRUZ, JUAN, SANTOS','M']
];
async function workbook(){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('SF1');
 rows.forEach(row=>sheet.addRow(row));
 return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
}
function harness(existing=[]){
 const endpoints={},calls=[];
 const query=async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('FROM school_years WHERE'))return {rowCount:1,rows:[{school_year_id:'year-2026',school_year_label:'2026-2027'}]};
  if(sql.includes('school_offers_grade'))return {rowCount:1,rows:[{allowed:true}]};
  if(sql.includes('FROM students WHERE school_id=$1 AND (lrn=ANY'))return {rowCount:existing.length,rows:existing};
  if(sql.includes('SELECT student_id FROM students WHERE school_id=$1 AND lrn=$2'))return {rowCount:0,rows:[]};
  if(sql.includes('INSERT INTO attendigo_student_short_id_counters'))return {rowCount:1,rows:[{last_number:1}]};
  return {rowCount:1,rows:[]};
 };
 const client={query,release(){}},pool={query,connect:async()=>client};
 const app={post:(route,...handlers)=>{endpoints[route]=handlers.at(-1);}};
 registerSf1ImportRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
 const invoke=async(route,body)=>{
  const req={body,auth:{role:'SCHOOL_ADMIN',schoolId:'school-demo',userId:'admin-demo'}};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  await endpoints[route](req,res);
  return res;
 };
 return {invoke,calls};
}

test('SF1 grade auto-detection applies to all learners; section is not guessed',()=>{
 const parsed=parseSf1Matrix(rows);
 assert.equal(parsed.gradeLevel,'Grade 8');
 assert.equal(parsed.learners[0].gradeLevel,'Grade 8');
 assert.equal(parsed.learners[0].section,'Unassigned');
 const pdf=['School Form 1 (SF1) School Register',
 'School Year: 2026-2027 Grade Level: 8 Section: Tuvera',
 'LRN NAME Sex (M/F) Address',
 '123456789012 DELA CRUZ, JUAN, SANTOS M Some Address'].join('\n');
 assert.equal(parseSf1PdfText(pdf).learners[0].gradeLevel,'Grade 8');
});

test('SF1 create automatically stores grade in both learner and active enrollment',async()=>{
 const h=harness(),body={fileBase64:await workbook(),fileType:'xlsx'};
 const preview=await h.invoke('/api/students/sf1/preview',body);
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.autoAssignedGradeCount,1);
 assert.equal(preview.body.gradeLevel,'Grade 8');
 assert.equal(preview.body.rows[0].section,'Unassigned');
 const commit=await h.invoke('/api/students/sf1/commit',body);
 assert.equal(commit.statusCode,200,JSON.stringify(commit.body));
 assert.equal(commit.body.autoAssignedGradeCount,1);
 assert.equal(commit.body.gradeLevel,'Grade 8');
 const studentInsert=h.calls.find(c=>c.sql.includes('INSERT INTO students('));
 const enrollmentInsert=h.calls.find(c=>c.sql.includes('INSERT INTO student_enrollments('));
 assert.equal(studentInsert.params[4],'Grade 8');
 assert.equal(enrollmentInsert.params[3],'Grade 8');
 assert.match(studentInsert.sql,/'Unassigned'/);
 assert.match(enrollmentInsert.sql,/'Unassigned'/);
 assert.equal(h.calls.filter(c=>/DELETE FROM|UPDATE student_enrollments|UPDATE attendance/i.test(c.sql)).length,0);
});

test('existing learner with a different stored grade is flagged for manual promotion review',async()=>{
 const h=harness([{lrn:'123456789012',student_id:'26-00001',full_name:'JUAN SANTOS DELA CRUZ',sex:'MALE',grade_level:'Grade 7',section:'Rizal',active:true,archived_at:null}]);
 const body={fileBase64:await workbook(),fileType:'xlsx'};
 const preview=await h.invoke('/api/students/sf1/preview',body);
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.summary.review,1);
 assert.equal(preview.body.autoAssignedGradeCount,0);
 assert.match(preview.body.rows[0].errors.join(' '),/SF1 grade Grade 8 differs from the saved Grade 7/);
 const commit=await h.invoke('/api/students/sf1/commit',body);
 assert.equal(commit.statusCode,409);
 assert.equal(h.calls.filter(c=>/INSERT INTO students|INSERT INTO student_enrollments|UPDATE students|DELETE FROM|UPDATE attendance/i.test(c.sql)).length,0);
});

test('SF1 is the default import source with visible grade and filtered roster shortcut',()=>{
 const root=path.join(__dirname,'..');
 const js=fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
 assert.match(js,/studentImportFormat'\)\.value = 'sf1'/);
 assert.match(js,/studentImportDetectedGrade/);
 assert.match(js,/autoAssignedGradeCount/);
 assert.match(js,/gradeFilter\.value=result\.gradeLevel/);
 assert.match(html,/id="studentImportDetectedGrade"/);
 assert.match(html,/sf1-review-cards\.css\?v=2/);
});
