'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('adviser grade and section choices include school-registered sections before enrollment',()=>{
 const server=read('server.js'),js=read('public/portal.js');
 const start=server.indexOf("app.get('/api/class-adviser-eligible-sections'"),end=server.indexOf("app.post('/api/class-adviser-assignments'",start);
 assert.ok(start>=0&&end>start);
 const endpoint=server.slice(start,end);
 assert.match(endpoint,/FROM school_sections ss WHERE ss\.school_id=\$1 AND ss\.active=TRUE/);
 assert.match(endpoint,/UNION ALL/);
 assert.match(endpoint,/BOOL_OR\(x\.registered\)/);
 assert.match(endpoint,/FROM students s LEFT JOIN LATERAL/);
 assert.doesNotMatch(endpoint,/req\.auth\.departmentId|INSERT INTO class_adviser_assignments/);
 assert.match(js,/registered section \(no enrolled learners yet\)/);
});
test('adviser creation and editing accept only registered or active-learner sections',()=>{
 const server=read('server.js');
 const create=server.indexOf("app.post('/api/class-adviser-assignments'"),
       edit=server.indexOf("app.patch('/api/class-adviser-assignments/:assignmentId'",create),
       remove=server.indexOf("app.delete('/api/class-adviser-assignments/:assignmentId'",edit);
 assert.ok(create>0&&edit>create&&remove>edit);
 for(const endpoint of [server.slice(create,edit),server.slice(edit,remove)]){
  assert.match(endpoint,/UNION\s+SELECT 1 FROM school_sections ss/);
  assert.match(endpoint,/ss\.school_id=\$1 AND ss\.active=TRUE/);
  assert.match(endpoint,/LOWER\(BTRIM\(ss\.grade_level\)\)=LOWER\(BTRIM\(\$2\)\)/);
  assert.match(endpoint,/UPPER\(BTRIM\(ss\.section_name\)\)=UPPER\(BTRIM\(\$3\)\)/);
  assert.match(endpoint,/FROM students s/);
 }
 assert.match(server,/You can assign only teachers in your own department/);
});
test('teacher designations remain separate from adviser section assignments',()=>{
 const server=read('server.js'),a=server.indexOf("app.get('/api/class-adviser-eligible-sections'"),
 b=server.indexOf("app.post('/api/class-adviser-assignments'",a);
 assert.doesNotMatch(server.slice(a,b),/UPDATE school_users|teacher_designations=/);
 assert.match(server,/ON CONFLICT\(school_id,grade_level,section\)/);
});
