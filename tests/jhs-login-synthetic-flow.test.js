'use strict';
// Fictional accounts + a fake SQL adapter. Exercises real auth route handlers
// without connecting to, seeding or modifying any user/school database.
const test=require('node:test'),assert=require('node:assert/strict');
const {registerAuthRoutes}=require('../auth-routes');
const {hashPassword}=require('../auth-security');
const SCHOOL_A='11111111-1111-4111-8111-111111111111';
const SCHOOL_B='22222222-2222-4222-8222-222222222222';
const PASSWORD='Fictional-Only-Validation-2026!';
const schools=[
 {school_id:SCHOOL_A,school_code:'JHS-A',school_name:'Fictional JHS A'},
 {school_id:SCHOOL_B,school_code:'JHS-B',school_name:'Fictional JHS B'}
];
function buildHarness(hash,role='TEACHER',{active=true,locked_until=null}={}){
 const events=[],routes=new Map();
 const subject={user_id:'33333333-3333-4333-8333-333333333333',
  school_id:SCHOOL_A,username:'sample.staff',display_name:'Sample JHS Staff',
  password_hash:hash,role,teacher_designations:role==='TEACHER'?['SUBJECT_TEACHER','CLASS_ADVISER']:[],
  active,must_change_password:false,department_id:null,department_code:null,locked_until};
 const student={student_account_id:'44444444-4444-4444-8444-444444444444',
  student_id:'2026-G8-001',username:'2026-G8-001',password_hash:hash,
  active:true,must_change_password:false,locked_until:null,full_name:'Sample Grade 8 Learner',
  grade_level:'Grade 8',section:'Mabini'};
 const pool={async query(sql,params=[]){
  events.push({sql,params});
  if(sql.includes('FROM schools WHERE lower(school_code)')){
   const found=schools.find(x=>x.school_code.toLowerCase()===String(params[0]).toLowerCase());
   return {rowCount:found?1:0,rows:found?[found]:[]};
  }
  if(sql.includes('FROM school_users su')&&sql.includes('WHERE su.school_id=$1')){
   const found=params[0]===SCHOOL_A&&String(params[1]).toLowerCase()===subject.username;
   return {rowCount:found?1:0,rows:found?[subject]:[]};
  }
  if(sql.includes('FROM student_accounts sa')&&sql.includes('JOIN students s')){
   const found=params[0]===SCHOOL_A&&String(params[1]).toLowerCase()===student.username.toLowerCase();
   return {rowCount:found?1:0,rows:found?[student]:[]};
  }
  if(sql.includes('INSERT INTO user_sessions')||sql.includes('INSERT INTO student_sessions'))
   return {rowCount:1,rows:[]};
  if(sql.includes('UPDATE school_users')||sql.includes('UPDATE student_accounts'))
   return {rowCount:1,rows:[]};
  // Each unauthenticated first login has no existing staff/student cookies.
  throw Error('Unexpected test SQL: '+sql.slice(0,120));
 }};
 const app=new Proxy({},{get:(_target,method)=>(route,...handlers)=>{
  routes.set(method.toUpperCase()+' '+route,handlers.at(-1));
 }});
 registerAuthRoutes(app,pool);
 async function hit(route,{schoolCode='JHS-A',username='sample.staff',password=PASSWORD}={}){
  const handler=routes.get('POST '+route);
  assert.equal(typeof handler,'function','Auth endpoint registered');
  const headers={};
  const response={
   statusCode:200,body:null,status(code){this.statusCode=code;return this;},
   json(body){this.body=body;return this;},
   setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];}
  };
  await handler({body:{schoolCode,username,password},headers:{},ip:'127.0.0.1',path:route},response);
  return {status:response.statusCode,body:response.body,headers};
 }
 return {hit,events};
}

for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER','PARENT'])
 test('Synthetic '+role+' staff login succeeds in its own school with correctly scoped role',async()=>{
  const hash=await hashPassword(PASSWORD),h=buildHarness(hash,role);
  const r=await h.hit('/api/auth/school/login');
  assert.equal(r.status,200,r.body?.error);
  assert.equal(r.body.user.schoolId,SCHOOL_A);
  assert.equal(r.body.user.role,role);
  assert.equal(r.body.user.userId,'33333333-3333-4333-8333-333333333333');
  assert.equal(r.body.user.mustChangePassword,false);
  assert.match(String(r.headers['Set-Cookie']),/__Host-attendigo-staff=/);
  assert.ok(h.events.some(x=>x.sql.includes('INSERT INTO user_sessions')));
 });
test('Synthetic Grade 8 learner signs in through student-only endpoint, never staff session',async()=>{
 const hash=await hashPassword(PASSWORD),h=buildHarness(hash);
 const r=await h.hit('/api/auth/student/login',{username:'2026-G8-001'});
 assert.equal(r.status,200,r.body?.error);
 assert.equal(r.body.user.role,'STUDENT');
 assert.equal(r.body.user.studentId,'2026-G8-001');
 assert.equal(r.body.user.schoolId,SCHOOL_A);
 assert.match(String(r.headers['Set-Cookie']),/__Host-attendigo-student=/);
 assert.equal(h.events.some(x=>x.sql.includes('INSERT INTO user_sessions')),false);
 assert.ok(h.events.some(x=>x.sql.includes('INSERT INTO student_sessions')));
});
test('Cross-school account lookup cannot authenticate to another school or create session',async()=>{
 const hash=await hashPassword(PASSWORD),h=buildHarness(hash);
 const r=await h.hit('/api/auth/school/login',{schoolCode:'JHS-B'});
 assert.equal(r.status,401);
 assert.equal(h.events.some(x=>x.sql.includes('INSERT INTO user_sessions')),false);
 assert.ok(h.events.some(x=>x.sql.includes('WHERE su.school_id=$1')));
});
test('Invalid credentials and inactive/locked staff accounts cannot sign in',async()=>{
 const hash=await hashPassword(PASSWORD);
 const wrong=buildHarness(hash),bad=await wrong.hit('/api/auth/school/login',{password:'Definitely-The-Wrong-Password'});
 assert.equal(bad.status,401);
 assert.ok(wrong.events.some(x=>x.sql.includes('SET failed_login_attempts')));
 assert.equal(wrong.events.some(x=>x.sql.includes('INSERT INTO user_sessions')),false);
 const inactive=await buildHarness(hash,'TEACHER',{active:false}).hit('/api/auth/school/login');
 assert.equal(inactive.status,401);
 const locked=await buildHarness(hash,'TEACHER',{locked_until:new Date(Date.now()+3600000).toISOString()}).hit('/api/auth/school/login');
 assert.equal(locked.status,423);
});
test('Missing school or password is rejected before account lookup',async()=>{
 const hash=await hashPassword(PASSWORD),h=buildHarness(hash);
 const r=await h.hit('/api/auth/school/login',{schoolCode:''});
 assert.equal(r.status,400);
 assert.equal(h.events.length,0);
});
