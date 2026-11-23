'use strict';
// Self-contained, isolated PostgreSQL + authenticated HTTP regression.
// This MUST NOT run against production/staging. Fixtures exist only in CI's
// disposable database; no memorandum or alert is sent to real school accounts.
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const crypto=require('node:crypto');
const express=require('express');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerSchoolMemoRoutes}=require('../school-memo-routes');
const {registerNotificationRoutes}=require('../notification-routes');
const {readFileSync}=require('node:fs');
const path=require('node:path');

function makePdf(){
 // One-page PDF with a real xref table; a document viewer can open it.
 const chunks=['%PDF-1.4\n'],offsets=[0];
 function part(s){chunks.push(s);}
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  (()=>{const stream='BT /F1 14 Tf 65 690 Td (ATTENDIGO FICTIONAL TEST MEMORANDUM - DO NOT DISTRIBUTE) Tj ET\n';return '<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream';})(),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
 ];
 const length=()=>Buffer.byteLength(chunks.join(''),'utf8');
 for(let i=0;i<objects.length;i++){offsets.push(length());part((i+1)+' 0 obj\n'+objects[i]+'\nendobj\n');}
 const xref=length();
 part('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n');
 for(let i=1;i<offsets.length;i++)part(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 part('trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.from(chunks.join(''),'utf8');
}
async function main(){
 const u=process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL);
 assert.ok(u&&u.pathname==='/school_attendance_test'&&['127.0.0.1','localhost'].includes(u.hostname),
  'Refusing memo E2E outside isolated local school_attendance_test database');
 const pool=new Pool({connectionString:u.toString(),max:8,connectionTimeoutMillis:5000});
 let srv;let assertions=0;
 const test=(description,fn)=>{assertions++;return Promise.resolve().then(fn).then(()=>console.log('PASS '+description));};
 try{
  const suffix=crypto.randomBytes(4).toString('hex');
  const departments=new Map();
  async function school(tag){
   const id=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    ['MEMO-E2E-'+tag+'-'+suffix,'Disposable School '+tag])).rows[0].school_id;
   const dep=(await pool.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'TEST','Fictional Department') RETURNING department_id",[id])).rows[0].department_id;
   departments.set(id,dep);
   return id;
  }
  async function account(schoolId,role,n,active=true){
   const id=(await pool.query(`
    INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,active,must_change_password,teacher_designations)
    VALUES($1,$2,$3,$4,'e2e-not-login', $5,$6,FALSE,$7::text[]) RETURNING user_id`,
    [schoolId,departments.get(schoolId),'memo_'+n+'_'+suffix,'Fictional '+n,role,active,
     role==='TEACHER'?['SUBJECT_TEACHER']:[]])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
       VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '20 minutes')`,
     [hashToken(token),schoolId,id]);
   return {id,token,role};
  }
  const a=await school('A'),b=await school('B');
  const p=await account(a,'PRINCIPAL','principal');
  const admin=await account(a,'SCHOOL_ADMIN','admin');
  const head=await account(a,'DEPARTMENT_HEAD','department_head');
  const teacher=await account(a,'TEACHER','teacher');
  const gate=await account(a,'GATE_KEEPER','gatekeeper');
  const parent=await account(a,'PARENT','parent');
  const inactive=await account(a,'TEACHER','inactive',false);
  const foreignPrincipal=await account(b,'PRINCIPAL','other_principal');
  const foreignTeacher=await account(b,'TEACHER','other_teacher');
  const studentId='FICT-MEMO-'+suffix;
  await pool.query(`INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile,active)
    VALUES($1,$2,'Fictional Student','Grade 9','Test-A','09000000000',TRUE)`,[a,studentId]);
  const studentAccount=(await pool.query(`
    INSERT INTO student_accounts(school_id,student_id,username,password_hash,active,must_change_password)
    VALUES($1,$2,$3,'e2e-not-login',TRUE,FALSE) RETURNING student_account_id`,
    [a,studentId,'memo_student_'+suffix])).rows[0].student_account_id;
  const studentToken=createOpaqueToken();
  await pool.query(`INSERT INTO student_sessions(token_hash,school_id,student_account_id,expires_at)
    VALUES($1,$2,$3,NOW()+INTERVAL '20 minutes')`,
    [hashToken(studentToken),a,studentAccount]);
  const student={id:studentAccount,token:studentToken,role:'STUDENT'};
  const app=express();
  // Matches production's JSON parser followed by memo's raw PDF body parser.
  app.use(express.json({limit:'10mb'}));
  const auth=createAuthMiddleware(pool);
  registerSchoolMemoRoutes(app,pool,auth);
  registerNotificationRoutes(app,pool,{authenticateSchoolClient:auth.authenticateSchoolClient,authenticatePlatform:auth.authenticatePlatform});
  srv=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const base='http://127.0.0.1:'+srv.address().port;
  async function call(who,method,uri,headers={},body){
   const h={...headers};
   if(who?.token)h.Authorization='Bearer '+who.token;
   const response=await fetch(base+uri,{method,headers:h,body,cache:'no-store'});
   const ct=response.headers.get('content-type')||'';
   const payload=ct.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
   return {code:response.status,body:payload,headers:response.headers};
  }
  async function publish(who,{title='Fictional memo: attendance-free test',audience='ALL_USERS',category='GENERAL',effectiveDate='',pdf=makePdf()}={}){
   return call(who,'POST','/api/school-memos',{
    'Content-Type':'application/pdf','x-filename':encodeURIComponent('TEST-FICTIONAL.pdf'),
    'x-memo-title':encodeURIComponent(title),'x-memo-summary':encodeURIComponent('Test only. This is not a real school directive.'),
    'x-memo-audience':audience,'x-memo-category':category,'x-memo-effective-date':effectiveDate
   },pdf);
  }
  const baseline=await pool.query(`SELECT
    (SELECT count(*) FROM school_calendar_exceptions WHERE school_id=$1)::int AS calendars,
    (SELECT count(*) FROM staff_attendance_events WHERE school_id=$1)::int AS staff_events,
    (SELECT count(*) FROM attendance_events WHERE school_id=$1)::int AS learner_events`,[a]);

  await test('no anonymous access to the memorandum API',async()=>{
   assert.equal((await call(null,'GET','/api/school-memos')).code,401);
   assert.equal((await publish(null)).code,401);
  });
  await test('only a principal can publish',async()=>{
   assert.equal((await publish(teacher)).code,403);
   assert.equal((await publish(admin)).code,403);
   assert.equal((await publish(student)).code,401);
   assert.equal((await publish(parent)).code,403);
  });
  await test('fabricated PDF fails closed without creating a memo',async()=>{
   const fake=await publish(p,{pdf:Buffer.from('not a PDF')});
   assert.equal(fake.code,400,JSON.stringify(fake.body));
   assert.equal(Number((await pool.query('SELECT count(*) AS n FROM school_memoranda WHERE school_id=$1',[a])).rows[0].n),0);
  });
  await test('official suspension notice cannot omit its effective date',async()=>{
   const bad=await publish(p,{category:'CLASS_SUSPENSION'});
   assert.equal(bad.code,400);
  });
  const pdf=makePdf(), title='Fictional School Memorandum – Test '+suffix;
  const published=await publish(p,{title,pdf});
  assert.equal(published.code,201,JSON.stringify(published.body));
  const memo=published.body.memoId;
  await test('principal publishes a real PDF; exactly active accounts are notified',async()=>{
   assert.match(memo,/^[0-9a-f-]{36}$/);
   assert.equal(published.body.notifiedAccounts,7,'6 active school users + 1 registered student');
   const notifications=await pool.query(`
    SELECT recipient_kind,recipient_id FROM user_notifications
    WHERE school_id=$1 AND event_key=$2`,[a,'memo:'+memo]);
   assert.equal(notifications.rowCount,7);
   assert.equal(notifications.rows.some(r=>r.recipient_id===inactive.id),false);
   assert.equal(notifications.rows.some(r=>r.recipient_id===foreignTeacher.id),false);
  });
  await test('teacher, parent and student receive targeted in-app notifications',async()=>{
   for(const user of [teacher,parent,student]){
    const r=await call(user,'GET','/api/notifications');
    assert.equal(r.code,200,JSON.stringify(r.body));
    assert.ok(r.body.notifications.some(n=>n.requestId===memo&&n.actionUrl==='/school-memos.html?id='+memo));
   }
   assert.equal((await call(foreignTeacher,'GET','/api/notifications')).body.notifications.some(n=>n.requestId===memo),false);
  });
  await test('same-school principal, staff, parent and student can view a published memo',async()=>{
   for(const user of [p,admin,head,teacher,gate,parent,student]){
    const r=await call(user,'GET','/api/school-memos');
    assert.equal(r.code,200,JSON.stringify(r.body));
    const item=r.body.memoranda.find(x=>x.memoId===memo);
    assert.ok(item,'Published memo should appear for '+user.role);
    assert.equal(item.acknowledgedAt,null);
    assert.equal(item.title,title);
   }
   assert.deepEqual((await call(foreignPrincipal,'GET','/api/school-memos')).body.memoranda,[]);
   assert.equal((await call(foreignPrincipal,'GET','/api/school-memos/'+memo+'/file')).code,404);
  });
  await test('document opens with correct bytes and is not implicitly marked read',async()=>{
   const file=await call(teacher,'GET','/api/school-memos/'+memo+'/file');
   assert.equal(file.code,200);
   assert.equal(file.headers.get('content-type'),'application/pdf');
   assert.equal(file.headers.get('cache-control'),'private, no-store');
   assert.deepEqual(file.body,pdf);
   const list=await call(teacher,'GET','/api/school-memos');
   assert.equal(list.body.memoranda.find(x=>x.memoId===memo).acknowledgedAt,null);
  });
  await test('student, parent and teacher explicitly acknowledge; repeats remain idempotent',async()=>{
   for(const user of [teacher,parent,student]){
    const r=await call(user,'POST','/api/school-memos/'+memo+'/acknowledge');
    assert.equal(r.code,200,JSON.stringify(r.body));
    assert.equal(r.body.alreadyAcknowledged,false);
    assert.equal((await call(user,'GET','/api/school-memos')).body.memoranda[0].acknowledgedAt!==null,true);
    const second=await call(user,'POST','/api/school-memos/'+memo+'/acknowledge');
    assert.equal(second.code,200);
    assert.equal(second.body.alreadyAcknowledged,true);
   }
   assert.equal((await call(foreignTeacher,'POST','/api/school-memos/'+memo+'/acknowledge')).code,404);
  });
  await test('only principal can view correct notified vs acknowledged counts',async()=>{
   const own=await call(p,'GET','/api/school-memos/'+memo+'/receipts');
   assert.equal(own.code,200,JSON.stringify(own.body));
   assert.equal(own.body.notifiedAccounts,7);
   assert.equal(own.body.acknowledgedAccounts,3);
   assert.equal((await call(teacher,'GET','/api/school-memos/'+memo+'/receipts')).code,403);
   assert.equal((await call(foreignPrincipal,'GET','/api/school-memos/'+memo+'/receipts')).code,404);
  });
  const staff=await publish(p,{title:'Fictional STAFF-ONLY notice',audience:'SCHOOL_STAFF'});
  assert.equal(staff.code,201,JSON.stringify(staff.body));
  await test('staff-only memo excludes parents and registered students',async()=>{
   assert.equal(staff.body.notifiedAccounts,5);
   for(const user of [parent,student]){
    assert.equal((await call(user,'GET','/api/school-memos')).body.memoranda.some(m=>m.memoId===staff.body.memoId),false);
    assert.equal((await call(user,'GET','/api/school-memos/'+staff.body.memoId+'/file')).code,403);
    assert.equal((await call(user,'POST','/api/school-memos/'+staff.body.memoId+'/acknowledge')).code,403);
   }
   assert.equal((await call(gate,'GET','/api/school-memos')).body.memoranda.some(m=>m.memoId===staff.body.memoId),true);
   assert.equal((await call(foreignPrincipal,'POST','/api/school-memos/'+memo+'/archive')).code,404);
  });
  await test('principal archives a memo, preserving the audit and acknowledgments',async()=>{
   assert.equal((await call(teacher,'POST','/api/school-memos/'+memo+'/archive')).code,403);
   const archived=await call(p,'POST','/api/school-memos/'+memo+'/archive');
   assert.equal(archived.code,200,JSON.stringify(archived.body));
   assert.equal((await call(teacher,'GET','/api/school-memos/'+memo+'/file')).code,404);
   assert.equal((await call(student,'GET','/api/school-memos')).body.memoranda.some(m=>m.memoId===memo),false);
   const audit=await pool.query('SELECT action FROM school_memo_audit WHERE school_id=$1 AND memo_id=$2 ORDER BY created_at',[a,memo]);
   assert.deepEqual(audit.rows.map(x=>x.action),['PUBLISHED','ARCHIVED']);
   const ack=await pool.query('SELECT COUNT(*)::int AS count FROM school_memo_acknowledgments WHERE school_id=$1 AND memo_id=$2',[a,memo]);
   assert.equal(ack.rows[0].count,3);
  });
  await test('memo workflow has zero impact on calendars, staff DTR or learner attendance',async()=>{
   const after=await pool.query(`SELECT
    (SELECT count(*) FROM school_calendar_exceptions WHERE school_id=$1)::int AS calendars,
    (SELECT count(*) FROM staff_attendance_events WHERE school_id=$1)::int AS staff_events,
    (SELECT count(*) FROM attendance_events WHERE school_id=$1)::int AS learner_events`,[a]);
   assert.deepEqual(after.rows,baseline.rows);
  });
  await test('browser assets link memo notice to publication and acknowledgment UI',async()=>{
   const principalHtml=readFileSync(path.join(__dirname,'../public/principal.html'),'utf8');
   const viewerHtml=readFileSync(path.join(__dirname,'../public/school-memos.html'),'utf8');
   const viewerJs=readFileSync(path.join(__dirname,'../public/school-memos.js'),'utf8');
   assert.match(principalHtml,/id="principalMemoForm"/);
   assert.match(principalHtml,/school-memo-banner\.js\?v=/);
   assert.match(viewerHtml,/id="memoList"/);
   assert.ok(viewerJs.includes("'/acknowledge'")&&viewerJs.includes("'/api/school-memos/"));
  });
  console.log('MEMORANDA E2E PASS: '+assertions+' grouped assertions; fictional accounts; real HTTP, sessions, SQL, files and notifications; isolated DB.');
 }finally{
  if(srv)await new Promise(resolve=>srv.close(resolve));
  await pool.end();
 }
}
main().catch(e=>{console.error('MEMORANDA E2E FAILED:',e);process.exitCode=1;});
