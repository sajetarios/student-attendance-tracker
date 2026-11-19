'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseSf1Matrix,extractName,parseSf1Base64}=require('../sf1-import-parser');
const ExcelJS=require('exceljs');
test('reads SF1 merged-style header, learner rows, and ignores totals',()=>{
 const rows=[
 ['School Form 1 (SF1) School Register'],
 ['School Year: 2026-2027','Grade Level: 8','Section: RIZAL'],
 ['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)','Religion'],
 ['123456789012','DELA CRUZ, JUAN, SANTOS','M','ignored'],
 ['123456789013','REYES, ANA, MARIA','F','ignored'],
 ['','TOTAL','2','']
 ];
 const result=parseSf1Matrix(rows);
 assert.equal(result.gradeLevel,'Grade 8');
 assert.equal(result.schoolYear,'2026-2027');
 assert.equal(result.learners.length,2);
 assert.equal(result.learners[0].fullName,'JUAN SANTOS DELA CRUZ');
 assert.equal(result.learners[0].section,'Unassigned');
 assert.equal(result.learners[1].sex,'FEMALE');
 assert.ok(result.learners.every(x=>!('religion' in x)));
});
test('rejects unrecognized spreadsheets rather than guessing row offsets',()=>{
 assert.throws(()=>parseSf1Matrix([['LRN','NAME'],['123456789012','A, B']]),/grade level/i);
 assert.throws(()=>parseSf1Matrix([['grade level 8'],['not an SF1 workbook']]),/SF1 LRN/i);
});
test('can read a generated ExcelJS workbook with an SF1-style sheet',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('School Form 1');
 s.addRow(['School Form 1','School Year: 2026-2027','Grade Level: 8']);
 s.addRow(['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)']);
 s.addRow(['123456789012','SANTOS, MARIA, REYES','F']);
 const base64=Buffer.from(await w.xlsx.writeBuffer()).toString('base64');
 const parsed=await parseSf1Base64(base64);
 assert.equal(parsed.learners.length,1);
 assert.equal(parsed.learners[0].lrn,'123456789012');
});
test('routes preserve authorization, generator and audit history',()=>{
 const routes=fs.readFileSync(path.join(__dirname,'..','sf1-import-routes.js'),'utf8');
 const student=fs.readFileSync(path.join(__dirname,'..','student-management-routes.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','public','portal.html'),'utf8');
 const portal=fs.readFileSync(path.join(__dirname,'..','public','portal.js'),'utf8');
 assert.match(routes,/requireSchoolRoles\('SCHOOL_ADMIN','TEACHER'\)/);
 assert.match(routes,/nextStudentId\(client/);
 assert.match(routes,/student_enrollments/);
 assert.match(routes,/STUDENT_SF1_IMPORT/);
 assert.match(routes,/Unassigned/);
 assert.match(student,/pending.created_by_user_id=\$3/);
 assert.match(html,/id="studentImportFormat"/);
 assert.match(html,/id="sf1CreateSectionButton"/);
 assert.match(portal,/api\/students\/sf1\/commit/);
 assert.match(portal,/api\/students\/sf1\/sections/);
});