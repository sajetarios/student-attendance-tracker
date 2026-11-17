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


test('Grade 8 adviser assignment submits successfully without section shadowing',async()=>{
 const server=read('server.js');
 const begin=server.indexOf("app.post('/api/class-adviser-assignments'");
 const end=server.indexOf("app.patch('/api/class-adviser-assignments/:assignmentId'",begin);
 assert.ok(begin>0&&end>begin);
 const code=server.slice(begin,end);
 let handler;
 const calls=[];
 const school='school-1',teacher='teacher-1',dept='english-1';
 const db={query:async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('SELECT department_id FROM school_users'))return {rowCount:1,rows:[{department_id:dept}]};
  if(sql.includes('FROM students s')&&sql.includes('UNION'))return {rowCount:1,rows:[{}]};
  if(sql.includes('FROM class_adviser_assignments ca JOIN school_users su'))return {rowCount:0,rows:[]};
  if(sql.includes('INSERT INTO class_adviser_assignments'))return {rowCount:1,rows:[{assignmentId:'assignment-1',adviserUserId:teacher,gradeLevel:'Grade 8',section:'SPJ TUVERA'}]};
  if(sql.includes('INSERT INTO audit_logs'))return {rowCount:1,rows:[]};
  throw Error('Unexpected SQL query: '+sql);
 }};
 new Function('app','authenticateSchoolClient','requireSchoolRoles','pool','isUuid','validText','console',code)(
   {post:(_path,...args)=>{handler=args[args.length-1]}},()=>{},()=>()=>{},db,()=>true,v=>Boolean(v),console
 );
 assert.equal(typeof handler,'function');
 const req={body:{adviserUserId:teacher,gradeLevel:'Grade 8',section:'SPJ TUVERA'},
 auth:{schoolId:school,departmentId:dept,userId:'head-1',role:'DEPARTMENT_HEAD'}};
 const res={statusCode:200,payload:null,status(code){this.statusCode=code;return this},json(data){this.payload=data;return this}};
 await handler(req,res);
 assert.equal(res.statusCode,201,JSON.stringify(res.payload));
 assert.equal(res.payload.assignment.section,'SPJ TUVERA');
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO class_adviser_assignments')));
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO audit_logs')));
});
test('Creation never silently overwrites an existing section adviser',async()=>{
 const server=read('server.js'),begin=server.indexOf("app.post('/api/class-adviser-assignments'"),
       end=server.indexOf("app.patch('/api/class-adviser-assignments/:assignmentId'",begin);
 const code=server.slice(begin,end);
 let handler;let insertCalled=false;
 const db={query:async(sql)=>{
  if(sql.includes('SELECT department_id FROM school_users'))return {rowCount:1,rows:[{department_id:'dep'}]};
  if(sql.includes('FROM students s')&&sql.includes('UNION'))return {rowCount:1,rows:[{}]};
  if(sql.includes('FROM class_adviser_assignments ca JOIN school_users su'))return {rowCount:1,rows:[{adviserUserId:'other',adviserName:'Existing Adviser'}]};
  if(sql.includes('INSERT INTO class_adviser_assignments'))insertCalled=true;
  throw Error('Unexpected query');
 }};
 new Function('app','authenticateSchoolClient','requireSchoolRoles','pool','isUuid','validText','console',code)(
  {post:(_path,...args)=>{handler=args[args.length-1]}},()=>{},()=>()=>{},db,()=>true,Boolean,console
 );
 const res={statusCode:200,payload:null,status(n){this.statusCode=n;return this},json(v){this.payload=v;return this}};
 await handler({body:{adviserUserId:'teacher',gradeLevel:'Grade 8',section:'SPJ TUVERA'},
 auth:{schoolId:'school',userId:'head',departmentId:'dep',role:'DEPARTMENT_HEAD'}},res);
 assert.equal(res.statusCode,409);
 assert.match(res.payload.error,/already has a Class Adviser/);
 assert.equal(insertCalled,false);
});
