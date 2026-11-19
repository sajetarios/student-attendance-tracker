'use strict';
// Isolated, rollback-only PostgreSQL acceptance. NEVER connect to live school data.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const raw=process.env.DATABASE_URL||'';
let url;
try{url=new URL(raw);}catch{throw Error('An explicitly local *_test PostgreSQL DATABASE_URL is required.');}
if(!['localhost','127.0.0.1','::1'].includes(url.hostname)||!/(?:^|_)test(?:_|$)/i.test(decodeURIComponent(url.pathname).slice(1)))
 throw Error('Refusing to run SHS migration acceptance on a non-local or non-test database.');
async function main(){
 const db=new Client({connectionString:raw});await db.connect();
 const a=randomUUID(),b=randomUUID(),year=randomUUID(),codeA='SYNSHS'+a.slice(0,8),codeB='SYNJHS'+b.slice(0,8);
 const studentA='SYN-'+a.slice(0,13),studentB='SYN-'+b.slice(0,13);
 try{
  await db.query('BEGIN');
  const migration=await db.query("SELECT 1 FROM schema_migrations WHERE migration_name='066_school_shs_levels_and_curriculum.sql'");
  assert.equal(migration.rowCount,1,'SHS migration must be applied first');
  await db.query('INSERT INTO schools(school_id,school_code,school_name) VALUES($1,$2,$3),($4,$5,$6)',
   [a,codeA,'Synthetic SHS School A',b,codeB,'Synthetic JHS School B']);
  assert.equal((await db.query("SELECT school_offers_grade($1,'Grade 11') AS ok",[a])).rows[0].ok,false);
  assert.equal((await db.query("SELECT school_offers_grade($1,'Grade 8') AS ok",[a])).rows[0].ok,true);
  await db.query('SAVEPOINT blocked_grade');
  try{
   await db.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,'Sample Student','Grade 11','A','')",[a,studentA]);
   throw Error('Expected grade 11 to be blocked for JHS-only school');
  }catch(error){
   assert.equal(error.code,'23514','The database must reject Grade 11 in JHS-only school');
   await db.query('ROLLBACK TO SAVEPOINT blocked_grade');
  }
  await db.query("INSERT INTO school_academic_levels(school_id,level_mode) VALUES($1,'INTEGRATED')",[a]);
  assert.equal((await db.query("SELECT school_offers_grade($1,'Grade 11') AS ok",[a])).rows[0].ok,true);
  await db.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,'Sample Grade Eleven','Grade 11','Mabini','')",[a,studentA]);
  await db.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,'Sample Grade Eight','Grade 8','Rizal','')",[b,studentB]);
  const scope=await db.query("SELECT school_id,student_id FROM students WHERE school_id=ANY($1::uuid[]) AND student_id=ANY($2::text[]) ORDER BY school_id",[ [a,b],[studentA,studentB] ]);
  assert.equal(scope.rows.length,2,'Both schools retain independent learner records');
  assert.equal((await db.query("SELECT school_offers_grade($1,'Grade 11') AS ok",[b])).rows[0].ok,false);
  await db.query("INSERT INTO school_years(school_year_id,school_id,school_year_label,start_date,end_date,status) VALUES($1,$2,'2026-2027','2026-06-01','2027-03-31','ACTIVE')",[year,a]);
  await db.query("INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date) VALUES($1,$2,$3,'Grade 11','Mabini','2026-06-01')",[a,studentA,year]);
  const enrollment=await db.query('SELECT enrollment_id FROM student_enrollments WHERE school_id=$1 AND student_id=$2',[a,studentA]);
  assert.equal(enrollment.rowCount,1);
  await db.query("INSERT INTO shs_year_curricula(school_id,school_year_id,grade_level,curriculum_version) VALUES($1,$2,'Grade 11','STRENGTHENED')",[a,year]);
  await db.query("INSERT INTO shs_learner_paths(school_id,enrollment_id,track_code,strand_code) VALUES($1,$2,'ACADEMIC','STEM')",[a,enrollment.rows[0].enrollment_id]);
  await db.query("UPDATE school_academic_levels SET level_mode='SHS_ONLY' WHERE school_id=$1",[a]);
  assert.equal((await db.query("SELECT school_offers_grade($1,'Grade 8') AS ok",[a])).rows[0].ok,false);
  await db.query('SAVEPOINT blocked_jhs');
  try{
   await db.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,'Forbidden Grade 8','Grade 8','Rizal','')",[a,'SYN-8-'+a.slice(0,11)]);
   throw Error('Expected Grade 8 to be blocked in SHS-only school');
  }catch(error){
   assert.equal(error.code,'23514');
   await db.query('ROLLBACK TO SAVEPOINT blocked_jhs');
  }
  const triggers=await db.query("SELECT tgrelid::regclass::text AS tab FROM pg_trigger WHERE tgname LIKE 'shs_school_grade_%' ORDER BY 1");
  assert.deepEqual(triggers.rows.map(x=>x.tab).sort(),['class_adviser_assignments','class_periods','school_sections','student_enrollments','students'].sort());
  console.log('SHS synthetic PostgreSQL acceptance PASSED: level restrictions, cross-school isolation, Grade 11 enrollment, track, trigger coverage.');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
main().catch(error=>{console.error('SHS synthetic PostgreSQL acceptance FAILED:',error.message);process.exitCode=1;});
