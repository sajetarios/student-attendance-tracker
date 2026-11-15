'use strict';
// One-time school-scoped demo reset. NEVER runs during npm start or deploy.
// Dry-run: node scripts/maintenance-reset-demo.js --school=DEMO001
// Execute: CONFIRM_DEMO_RESET=DEMO001 node scripts/maintenance-reset-demo.js --school=DEMO001 --execute
require('dotenv').config();
const {Pool}=require('pg');
const schoolCode=process.argv.find(x=>x.startsWith('--school='))?.split('=')[1];
const execute=process.argv.includes('--execute');
if(!schoolCode || !/^[A-Za-z0-9_-]{2,40}$/.test(schoolCode)) throw Error('Specify --school=EXACT_SCHOOL_CODE');
if(execute && process.env.CONFIRM_DEMO_RESET!==schoolCode) throw Error('Reset blocked: set CONFIRM_DEMO_RESET to the exact school code.');
if(!process.env.DATABASE_URL) throw Error('DATABASE_URL is required.');
// Render external PostgreSQL requires TLS. Verify the server certificate; never disable TLS verification.
const dbUrl=new URL(process.env.DATABASE_URL);
if(!['postgres:','postgresql:'].includes(dbUrl.protocol)) throw Error('DATABASE_URL must be PostgreSQL.');
for(const key of ['sslmode','sslcert','sslkey','sslrootcert']) dbUrl.searchParams.delete(key);
const pool=process.env.MAINTENANCE_USE_SERVICE_PG==='1'
 ? new Pool({connectionString:process.env.DATABASE_URL}) // Match the already-working Render web service connection.
 : new Pool({connectionString:dbUrl.toString(),ssl:{rejectUnauthorized:true}});
const tables=[
 'school_cloud_sync_outbox','sms_outbox','student_sessions','parent_student_links',
 'student_special_programs','student_movements','student_enrollments','student_accounts',
 'sf2_daily_overrides','sf2_submissions','attendance_events','teacher_gate_events',
 'teacher_period_substitutions','teacher_period_assignments','class_adviser_assignments',
 'school_calendar_exception_periods','school_calendar_exceptions','class_period_days',
 'class_periods','timetable_template_periods','timetable_templates','school_calendar',
 'school_years','school_subjects','students'
];
const names=[
 ['Andres','Bautista','MALE'],['Beatriz','Cruz','FEMALE'],['Carlos','Dela Rosa','MALE'],
 ['Diana','Flores','FEMALE'],['Emilio','Garcia','MALE'],['Fatima','Hernandez','FEMALE'],
 ['Gabriel','Ilagan','MALE'],['Hannah','Jimenez','FEMALE'],['Isaac','Lorenzo','MALE'],
 ['Julia','Mendoza','FEMALE'],['Kevin','Navarro','MALE'],['Lara','Reyes','FEMALE']
];
async function main(){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['demo-reset:'+schoolCode]);
  const schools=await c.query('SELECT school_id,school_code,school_name FROM schools WHERE school_code=$1 FOR UPDATE',[schoolCode]);
  if(schools.rowCount!==1) throw Error('Exactly one matching school is required.');
  const s=schools.rows[0], sid=s.school_id;
  // The durable marker is written in the SAME transaction as the reset.
  // Restarts, redeploys and accidental repeats cannot re-delete the seeded data.
  await c.query(`CREATE TABLE IF NOT EXISTS demo_reset_maintenance_runs (
    school_id uuid NOT NULL REFERENCES schools(school_id),
    operation text NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (school_id,operation)
  )`);
  const operation='DEMO_GRADE8_RESET_2026_11_15';
  const previous=await c.query('SELECT completed_at FROM demo_reset_maintenance_runs WHERE school_id=$1 AND operation=$2',[sid,operation]);
  if(previous.rowCount){
    console.log('DEMO_RESET_ALREADY_COMPLETED: '+s.school_code);
    await c.query('ROLLBACK');
    return;
  }
  const admin=await c.query("SELECT user_id FROM school_users WHERE school_id=$1 AND role='SCHOOL_ADMIN' AND active=TRUE ORDER BY created_at LIMIT 1",[sid]);
  if(!admin.rowCount) throw Error('An active School Admin account must exist.');
  const usersBefore=await c.query('SELECT user_id,username,role,password_hash FROM school_users WHERE school_id=$1 ORDER BY user_id',[sid]);
  const counts={};
  for(const t of tables) {
   const r=await c.query('SELECT count(*)::int AS n FROM "'+t+'" WHERE school_id=$1',[sid]);
   counts[t]=r.rows[0].n;
  }
  console.log(JSON.stringify({mode:execute?'EXECUTE':'DRY_RUN',school:s.school_code,name:s.school_name,preservedLoginAccounts:usersBefore.rowCount,deleteCounts:counts,createStudents:names.length},null,2));
  if(!execute){await c.query('ROLLBACK');return;}
  // Refuse an unexpected schema before touching data; no broad CASCADE or schema DROP.
  for(const t of tables) await c.query('DELETE FROM "'+t+'" WHERE school_id=$1',[sid]);
  // Preserve every school_users row, username, password hash, role and account status.
  // Clear teacher assignment metadata while satisfying teacher designation constraints.
  await c.query(`UPDATE school_users SET teacher_designations=CASE WHEN role='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END,
   teacher_status='ACTIVE',leave_type=NULL,leave_start_date=NULL,expected_return_date=NULL,updated_at=NOW()
   WHERE school_id=$1 AND role='TEACHER'`,[sid]);
  const dept=await c.query('SELECT department_id,department_name FROM school_departments WHERE school_id=$1 AND active=TRUE ORDER BY CASE WHEN department_code=$2 THEN 1 ELSE 0 END,department_name LIMIT 1',[sid,'UNASSIGNED']);
  if(!dept.rowCount) throw Error('School requires an active department.');
  const dep=dept.rows[0].department_id;
  const yr=await c.query(`INSERT INTO school_years(school_id,school_year_label,start_date,end_date,status,created_by_user_id)
   VALUES($1,'2026-2027','2026-06-01','2027-03-31','ACTIVE',$2) RETURNING school_year_id`,[sid,admin.rows[0].user_id]);
  const yearId=yr.rows[0].school_year_id;
  const templ=await c.query(`INSERT INTO timetable_templates(school_id,template_name,shift_code,created_by_user_id)
   VALUES($1,'DEMO - Grade 8 Regular','REGULAR',$2) RETURNING template_id`,[sid,admin.rows[0].user_id]);
  const templateId=templ.rows[0].template_id;
  const blocks=[['Period 1','08:00','09:00','CLASS'],['Period 2','09:00','10:00','CLASS'],['Morning Break','10:00','10:15','BREAK'],['Period 3','10:15','11:15','CLASS']];
  for(let i=0;i<blocks.length;i++){
   const b=blocks[i];
   await c.query('INSERT INTO timetable_template_periods(school_id,template_id,period_order,period_label,start_time,end_time,block_type) VALUES($1,$2,$3,$4,$5,$6,$7)',[sid,templateId,i+1,...b]);
  }
  const subject=await c.query(`INSERT INTO school_subjects(school_id,department_id,subject_name) VALUES($1,$2,'English 8 - DEMO') RETURNING subject_id`,[sid,dep]);
  const period=await c.query(`INSERT INTO class_periods(school_id,period_name,grade_level,section,subject_name,start_time,end_time,department_id,subject_id,classroom,timetable_template_id,active)
   VALUES($1,'DEMO English 8','Grade 8','Rizal - DEMO','English 8','08:00','09:00',$2,$3,'Room DEMO-01',$4,TRUE) RETURNING period_id`,[sid,dep,subject.rows[0].subject_id,templateId]);
  const periodId=period.rows[0].period_id;
  for(let day=1;day<=5;day++) await c.query('INSERT INTO class_period_days(school_id,period_id,weekday) VALUES($1,$2,$3)',[sid,periodId,day]);
  const teacher=await c.query("SELECT user_id FROM school_users WHERE school_id=$1 AND role='TEACHER' AND active=TRUE ORDER BY username LIMIT 1",[sid]);
  if(teacher.rowCount){
   const teacherId=teacher.rows[0].user_id;
   await c.query('UPDATE school_users SET department_id=$2,teacher_designations=ARRAY[\'CLASS_ADVISER\',\'SUBJECT_TEACHER\']::text[] WHERE school_id=$1 AND user_id=$3',[sid,dep,teacherId]);
   await c.query('INSERT INTO teacher_period_assignments(school_id,teacher_user_id,period_id) VALUES($1,$2,$3)',[sid,teacherId,periodId]);
   await c.query("INSERT INTO class_adviser_assignments(school_id,adviser_user_id,grade_level,section,assigned_by) VALUES($1,$2,'Grade 8','Rizal - DEMO',$3)",[sid,teacherId,admin.rows[0].user_id]);
  } else console.warn('No teacher login exists: demo class adviser and teacher assignment not created.');
  for(let i=0;i<names.length;i++){
   const [first,last,sex]=names[i],id='DEMO-G8-'+String(i+1).padStart(3,'0');
   await c.query(`INSERT INTO students(school_id,student_id,lrn,full_name,grade_level,section,parent_mobile,sex)
    VALUES($1,$2,$3,$4,'Grade 8','Rizal - DEMO','00000000000',$5)`,[sid,id,'99000000'+String(i+1).padStart(4,'0'),last+', '+first,sex]);
   await c.query(`INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,created_by_user_id)
    VALUES($1,$2,$3,'Grade 8','Rizal - DEMO','2026-06-01',$4)`,[sid,id,yearId,admin.rows[0].user_id]);
   // Five synthetic weekdays; school-scoped attendance is sufficient for SF2 daily presence.
   for(const day of ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']){
    if((i+Number(day.slice(-2)))%11===0) continue; // sample absences
    await c.query(`INSERT INTO attendance_events(event_id,school_id,device_id,student_id,attendance_scope,event_type,occurred_at_device,school_date,metadata)
     VALUES(gen_random_uuid(),$1,'DEMO-SEED',$2,'SCHOOL','TIME_IN',($3::date+time '07:35') AT TIME ZONE 'Asia/Manila',$3::date,'{"demo":true}'::jsonb)`,[sid,id,day]);
   }
  }
  const usersAfter=await c.query('SELECT user_id,username,role,password_hash FROM school_users WHERE school_id=$1 ORDER BY user_id',[sid]);
  if(JSON.stringify(usersAfter.rows)!==JSON.stringify(usersBefore.rows)) throw Error('Login integrity verification failed; rolling back.');
  const check=await c.query(`SELECT (SELECT count(*) FROM students WHERE school_id=$1) students,
   (SELECT count(*) FROM student_enrollments WHERE school_id=$1) enrollments,
   (SELECT count(*) FROM attendance_events WHERE school_id=$1) attendance_events`,[sid]);
  if(Number(check.rows[0].students)!==12||Number(check.rows[0].enrollments)!==12||Number(check.rows[0].attendance_events)<40) throw Error('Demo validation failed; rolling back.');
  await c.query('INSERT INTO demo_reset_maintenance_runs(school_id,operation) VALUES($1,$2)',[sid,operation]);
  await c.query('COMMIT');
  console.log('COMMITTED DEMO RESET',JSON.stringify(check.rows[0]));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
main().catch(e=>{console.error('Reset aborted:',e.message);process.exitCode=1}).finally(()=>pool.end());
