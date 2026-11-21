'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {extractOfficialParts,extractOfficialName}=require('../sf1-import-parser');
const formatter=require('../public/student-name-format');
const read=pathName=>fs.readFileSync(path.join(__dirname,'..',pathName),'utf8');

test('SF1 LIS triple field provides independently verified names',()=>{
 assert.deepEqual(extractOfficialParts('DE LA CRUZ, MARIA TERESA, REYES'),
   {lastName:'DE LA CRUZ',firstName:'MARIA TERESA',middleName:'REYES'});
 assert.deepEqual(extractOfficialParts('TERONA, ANGELICA, -'),
   {lastName:'TERONA',firstName:'ANGELICA',middleName:''});
 assert.equal(extractOfficialParts('TERONA, ANGELICA'),null);
 assert.equal(extractOfficialParts('ANGELICA TERONA'),null);
 assert.equal(extractOfficialName('MAGONCIA,ANDRIANA,BELOY'),'MAGONCIA, ANDRIANA BELOY');
});
test('client composes official names without guessing middle or compound surname',()=>{
 assert.deepEqual(formatter.composeParts('DE LA CRUZ','MARIA TERESA','REYES'),
 {lastName:'DE LA CRUZ',firstName:'MARIA TERESA',middleName:'REYES',
  fullName:'DE LA CRUZ, MARIA TERESA REYES'});
 assert.equal(formatter.composeParts('TERONA','ANGELICA','').fullName,'TERONA, ANGELICA');
 assert.throws(()=>formatter.composeParts('','ANGE',''),/Surname/);
 assert.throws(()=>formatter.composeParts('RAMOS','',''),/Surname/);
 assert.throws(()=>formatter.composeParts('A'.repeat(101),'B',''),/Surname/);
});
test('schema and source-verified Tuvera backfill never change identifiers',()=>{
 const sql=read('migrations/071_structured_student_names.sql');
 for(const name of ['last_name','first_name','middle_name','name_parts_source',
 'cd4b65cca13bef1228f4ea1df40e002a','BACKFILL','first_words','SF1_VERIFIED'])assert.ok(sql.includes(name),name);
 assert.match(sql,/SELECT COUNT\(\*\)::integer INTO eligible_count/);
 assert.match(sql,/eligible_count<>28/);
 assert.match(sql,/changed_count<>28/);
 assert.doesNotMatch(sql,/SET\s+(?:lrn|student_id|qr_token|birth_date)/);
 assert.doesNotMatch(sql,/\b(?:MAGONCIA|ANDRIANA|NONONG|LANCE JESSE)\b/i);
 assert.match(read('scripts/migrate.js'),/071_structured_student_names\.sql/);
});
test('SF1 Excel/PDF imports preserve parts and existing records require review',()=>{
 const imp=read('sf1-import-routes.js');
 const excel=read('sf1-import-parser.js');
 const pdf=read('sf1-pdf-parser.js');
 const layout=read('sf1-pdf-layout.js');
 assert.match(excel,/officialNameParts:extractOfficialParts\(rawName\)/);
 assert.match(pdf,/officialNameParts:extractOfficialParts\(rawName\)/);
 assert.match(layout,/officialNameParts:extractOfficialParts\(nameRaw\)/);
 assert.match(imp,/row\.officialNameParts\?\.lastName/);
 assert.match(imp,/missingFields\.push\('nameParts'\)/);
 assert.match(imp,/manual review required/);
 assert.match(imp,/sf1NamesEquivalent\(found\.full_name,r\.fullName\)/);
});
test('protected APIs and new/edit forms handle three official fields',()=>{
 const server=read('server.js');
 const page=read('public/portal.html');
 const ui=read('public/portal.js');
 for(const id of ['newLastName','newFirstName','newMiddleName','editSurname','editFirstName','editMiddleName'])assert.ok(page.includes('id="'+id+'"'),id);
 for(const name of ['last_name AS "lastName"','first_name AS "firstName"','middle_name AS "middleName"'])assert.ok(server.includes(name),name);
 assert.match(server,/submittedStudentNameParts\(req\.body,fullName\)/);
 assert.match(server,/TEACHER_STUDENT_SCOPE/);
 assert.match(server,/qrTokenPreserved: true/);
 assert.match(ui,/student\.lastName && student\.firstName/);
 assert.match(ui,/composeParts\(/);
 assert.match(ui,/payload.*fullName/);
 for(const file of ['portal.js?v=221','student-name-format.js?v=2']){
  assert.ok(read('public/portal.html').includes('/'+file));
  assert.ok(read('public/sw.js').includes('"/'+file+'"'));
 }
});
