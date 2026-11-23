'use strict';
// Disposable PostgreSQL verification only. Never run against a real school DB.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),express=require('express'),{Pool}=require('pg');
const {createAuthMiddleware}=require('../auth-middleware');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {registerPrincipalRoutes,manilaToday}=require('../principal-routes');
async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url&&new URL(url).pathname==='/school_attendance_test',
  'Principal integration tests may only touch disposable school_attendance_test');
 const pool=new Pool({connectionString:url,max:6,connectionTimeoutMillis:5000});
 let server;
 try{
  const suffix=crypto.randomBytes(5).toString('hex');
  async function makeSchool(prefix){
   const s=await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    [prefix+suffix,prefix+' fictional school']);
   const schoolId=s.rows[0].school_id;
   const dept=await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
    [schoolId,'ENG','English Department']);
   return {id:schoolId,departmentId:dept.rows[0].department_id};
  }
  async function makeUser(school,role,label){
   const u=await pool.query(`INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    VALUES($1,$2,$3,$4,'synthetic-test-session',$5,
    CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END)
    RETURNING user_id`,[school.id,school.departmentId,label+suffix,label,role]);
   const token=createOpaqueToken();
   await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
    VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '15 minutes')`,[hashToken(token),school.id,u.rows[0].user_id]);
   return {id:u.rows[0].user_id,token};
  }
  const a=await makeSchool('LEAD_A_'),b=await makeSchool('LEAD_B_');
  const principal=await makeUser(a,'PRINCIPAL','principal');
  const admin=await makeUser(a,'SCHOOL_ADMIN','school-admin');
  const teacher=await makeUser(a,'TEACHER','teacher');
  const otherPrincipal=await makeUser(b,'PRINCIPAL','other-principal');
  const otherTeacher=await makeUser(b,'TEACHER','other-teacher');
  await pool.query('INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,$3,$4,$5,$6)',
   [a.id,'PRINCIPAL_TEST_'+suffix,'Fictional student','Grade 8','Sample','000000']);
  const today=manilaToday();
  await pool.query(`INSERT INTO staff_attendance_events
   (school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,
    verification_status,verification_method,actor_user_id,client_event_key)
    VALUES($1,$2,'DTR_SLOT','AM_IN',$3::date,NOW(),'AUTHORIZED_CORRECTION','VERIFIED','MANUAL_REVIEW',$2,$4)`,
   [a.id,teacher.id,today,crypto.randomUUID()]);
  await pool.query(`INSERT INTO staff_attendance_events
   (school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,
    verification_status,actor_user_id,client_event_key)
    VALUES($1,$2,'DTR_SLOT','PM_IN',$3::date,NOW(),'SELF_SERVICE','PENDING_VERIFICATION',$2,$4)`,
   [a.id,teacher.id,today,crypto.randomUUID()]);
  await pool.query(`INSERT INTO staff_attendance_events
   (school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,
    verification_status,verification_method,actor_user_id,client_event_key)
    VALUES($1,$2,'DTR_SLOT','AM_IN',$3::date,NOW(),'AUTHORIZED_CORRECTION','VERIFIED','MANUAL_REVIEW',$2,$4)`,
   [b.id,otherTeacher.id,today,crypto.randomUUID()]);
  const app=express();app.use(express.json());
  const auth=createAuthMiddleware(pool);
  registerPrincipalRoutes(app,pool,auth);
  server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const base='http://127.0.0.1:'+server.address().port;
  async function request(method,path,token,body){
   const result=await fetch(base+path,{method,headers:{
    Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})
   },...(body?{body:JSON.stringify(body)}:{})});
   return {status:result.status,body:await result.json()};
  }
  const overview=await request('GET','/api/principal/overview?days=7',principal.token);
  assert.equal(overview.status,200,JSON.stringify(overview.body));
  assert.equal(overview.body.metrics.activeStudents,1);
  assert.equal(overview.body.metrics.activeTeachers,1);
  assert.equal(overview.body.metrics.todayVerifiedAmIn,1);
  assert.equal(overview.body.metrics.windowPendingScans,1);
  assert.equal(overview.body.metrics.windowVerifiedSlots,1);
  assert.equal(overview.body.trend.length,7);
  assert.equal(overview.body.trend.at(-1).verifiedAmIn,1);
  assert.equal(overview.body.comparison[0].name,'English Department');
  assert.equal(overview.body.comparison[0].pendingScans,1);
  const other=await request('GET','/api/principal/overview?days=7',otherPrincipal.token);
  assert.equal(other.status,200);assert.equal(other.body.metrics.activeStudents,0);
  assert.equal(other.body.metrics.activeTeachers,1);
  assert.equal(other.body.metrics.windowPendingScans,0);
  assert.equal((await request('GET','/api/principal/overview?days=7',teacher.token)).status,403);
  assert.equal((await request('GET','/api/principal/overview?days=7',admin.token)).status,403);
  assert.equal((await request('GET','/api/principal/overview?days=6',principal.token)).status,400);
  assert.equal((await request('GET','/api/principal/overview?days=30&departmentId='+b.departmentId,principal.token)).status,404);
  const scoped=await request('GET','/api/principal/overview?days=30&departmentId='+a.departmentId,principal.token);
  assert.equal(scoped.status,200);assert.equal(scoped.body.trend.length,30);
  assert.equal(scoped.body.metrics.activeStudents,1,'Students remain explicitly school-wide');
  assert.equal((await request('POST','/api/principal/accounts',principal.token,
   {username:'fakeprincipal',displayName:'Another Principal',password:'A_secure_password_123'})).status,403,
   'Principal cannot create another account');
  assert.equal((await request('POST','/api/principal/accounts',teacher.token,
   {username:'fakeprincipal',displayName:'Another Principal',password:'A_secure_password_123'})).status,403);
  const created=await request('POST','/api/principal/accounts',admin.token,
   {username:'principal-'+suffix,displayName:'New Fictional Principal',password:'A_secure_password_123'});
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.mustChangePassword,true);
  const stored=await pool.query(`SELECT role,must_change_password,password_hash FROM school_users
    WHERE school_id=$1 AND user_id=$2`,[a.id,created.body.account.userId]);
  assert.equal(stored.rows[0].role,'PRINCIPAL');
  assert.equal(stored.rows[0].must_change_password,true);
  assert.notEqual(stored.rows[0].password_hash,'A_secure_password_123');
  assert.equal((await request('POST','/api/principal/accounts',admin.token,
   {username:'principal-'+suffix,displayName:'Duplicate Principal',password:'A_secure_password_123'})).status,409);
  const untouched=await pool.query('SELECT COUNT(*)::int AS count FROM staff_attendance_events WHERE school_id=$1',[a.id]);
  assert.equal(untouched.rows[0].count,2,'Analytics never modify attendance records');
  console.log('Principal read-only leadership analytics, cross-school isolation and provisioning PASSED');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
