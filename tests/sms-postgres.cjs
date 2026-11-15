'use strict';
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {Pool}=require('pg');const express=require('express');
const {registerSmsRoutes}=require('../sms-routes');const {createAuthMiddleware}=require('../auth-middleware');const {startSmsWorker}=require('../sms-service');
(async()=>{
 assert.match(process.env.DATABASE_URL||'',/school_attendance_test/,'Disposable test database required');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});let server,worker;const schools=[];let requests=0;
 try{
  for(let i=0;i<2;i++){const id=randomUUID();await pool.query('INSERT INTO schools(school_id,school_code,school_name) VALUES($1,$2,$3)',[id,'SMS'+id,'SMS test school']);schools.push(id);await pool.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,'Example Student','Grade 7','A','09171234567')",[id,'student-'+id]);}
  const insert=async(school,{status='ACCEPTED',type='TIME_IN',date='2026-11-16',scope='SCHOOL',period=null}={})=>{const id=randomUUID();await pool.query(`INSERT INTO attendance_events(event_id,school_id,device_id,student_id,attendance_scope,event_type,occurred_at_device,school_date,sync_status,period_id) VALUES($1,$2,'TEST',$3,$4,$5,NOW(),$6,$7,$8)`,[id,school,'student-'+school,scope,type,date,status,period]);return id;};
  await insert(schools[0]);assert.equal((await pool.query('SELECT * FROM sms_outbox')).rowCount,0,'off by default');
  for(const id of schools)await pool.query('INSERT INTO school_sms_settings(school_id,enabled,enabled_at) VALUES($1,TRUE,NOW())',[id]);
  const event=await insert(schools[0],{type:'TIME_OUT'});await insert(schools[0],{status:'DUPLICATE'});
  assert.equal((await pool.query('SELECT * FROM sms_outbox')).rowCount,1,'duplicate attendance not queued');
  const m=(await pool.query('SELECT * FROM sms_outbox WHERE event_id=$1',[event])).rows[0];assert.equal(m.recipient,'639171234567');assert.match(m.message,/checked out/);assert.match(m.message,/\(PH\)/);
  await pool.query("INSERT INTO attendance_events SELECT * FROM attendance_events WHERE event_id=$1 ON CONFLICT DO NOTHING",[event]);assert.equal((await pool.query('SELECT * FROM sms_outbox')).rowCount,1,'same event retry is idempotent');
  await insert(schools[1]);
  const dep=(await pool.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'SMS','SMS') RETURNING department_id",[schools[0]])).rows[0].department_id;
  const period=(await pool.query("INSERT INTO class_periods(school_id,department_id,period_name,grade_level,section,start_time,end_time) VALUES($1,$2,'Math','Grade 7','A','08:00','09:00') RETURNING period_id",[schools[0],dep])).rows[0].period_id;
  await insert(schools[0],{scope:'CLASS',period});assert.equal((await pool.query('SELECT * FROM sms_outbox')).rowCount,2,'class disabled by default');
  await pool.query('UPDATE school_sms_settings SET class_events=TRUE WHERE school_id=$1',[schools[0]]);
  await insert(schools[0],{scope:'CLASS',period,type:'TIME_OUT'});assert.equal((await pool.query('SELECT * FROM sms_outbox')).rowCount,3,'class QR style insertion queued');
  const app=express();app.use(express.json());registerSmsRoutes(app,pool,{authenticateSchoolClient:(req,res,next)=>{if(!req.headers['x-school'])return res.sendStatus(401);req.auth={type:'SCHOOL_USER',schoolId:req.headers['x-school'],role:req.headers['x-role']||'SCHOOL_ADMIN'};next();},requireSchoolRoles:createAuthMiddleware(pool).requireSchoolRoles});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/sms/messages')).status,401);
  assert.equal((await fetch(base+'/api/sms/settings',{headers:{'x-school':schools[0],'x-role':'TEACHER'}})).status,403);
  const history=await (await fetch(base+'/api/sms/messages',{headers:{'x-school':schools[1]}})).json();assert.equal(history.messages.length,1);assert(!history.messages[0].recipient.includes('09171234567'));
  const env={SMS_DELIVERY_ENABLED:'true',SEMAPHORE_API_KEY:'fake'};
  const fakeFetch=async()=>{requests++;return {ok:true,status:200,json:async()=>[{message_id:requests,status:'Queued'}]};};
  worker=startSmsWorker(pool,{env,fetchImpl:fakeFetch,interval:999999});await worker.tick();await worker.tick();await worker.tick();assert.equal(requests,3);assert.equal((await pool.query("SELECT * FROM sms_outbox WHERE status='SENT'")).rowCount,3);await worker.stop();
  const changed=await insert(schools[0],{date:'2026-11-17'});await pool.query("UPDATE students SET parent_mobile='09181234567' WHERE school_id=$1",[schools[0]]);
  worker=startSmsWorker(pool,{env,fetchImpl:fakeFetch,interval:999999});await worker.tick();await worker.stop();assert.equal(requests,3,'old guardian must not receive SMS');assert.match((await pool.query('SELECT last_error FROM sms_outbox WHERE event_id=$1',[changed])).rows[0].last_error,/RECIPIENT_CHANGED/);
  const old=await insert(schools[0],{date:'2026-11-18'});await pool.query("UPDATE attendance_events SET occurred_at_device=NOW()-INTERVAL '2 days' WHERE event_id=$1",[old]);
  worker=startSmsWorker(pool,{env,fetchImpl:fakeFetch,interval:999999});await worker.tick();await worker.stop();assert.equal(requests,3,'historical attendance not sent');
  console.log('SMS PostgreSQL smoke passed: triggers, duplicate suppression, scopes, tenant isolation, role guards, provider acceptance, guardian changes, expiry. No real SMS sent.');
 }finally{if(worker)await worker.stop();if(server)await new Promise(r=>server.close(r));for(const id of schools)await pool.query('DELETE FROM schools WHERE school_id=$1',[id]);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
