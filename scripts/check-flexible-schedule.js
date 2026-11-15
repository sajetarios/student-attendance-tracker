'use strict';
const {Pool}=require('pg');
const {registerFlexibleScheduleRoutes}=require('../flexible-schedule-routes');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const safePool={
 query:(...args)=>pool.query(...args),
 connect:async()=>{
  const client=await pool.connect();
  // All COMMIT commands are replaced with ROLLBACK, so there is no durable test write.
  return {
   query:(statement,params)=>/^\s*COMMIT\s*;?\s*$/i.test(String(statement))
    ?client.query('ROLLBACK'):client.query(statement,params),
   release:()=>client.release()
  };
 }
};
async function main(){
 const school=await pool.query("SELECT school_id FROM schools WHERE school_code='DEMO001' AND active=TRUE");
 if(!school.rowCount)throw Error('DEMO001 school not found');
 const sid=school.rows[0].school_id;
 const admin=await pool.query("SELECT user_id FROM school_users WHERE school_id=$1 AND role='SCHOOL_ADMIN' AND active=TRUE LIMIT 1",[sid]);
 if(!admin.rowCount)throw Error('No demo admin');
 const period=await pool.query("SELECT period_id FROM class_periods WHERE school_id=$1 AND period_name='DEMO English 8' AND active=TRUE LIMIT 1",[sid]);
 if(!period.rowCount)throw Error('Demo English 8 period missing');
 const t=await pool.query(
  "SELECT user_id,display_name FROM school_users WHERE school_id=$1 AND role='TEACHER' AND active=TRUE",
  [sid]);
 const sub=t.rows.find(x=>x.display_name==='Dorothy Mae Sajetarios');
 const fil=t.rows.find(x=>x.display_name==='Christine Faith Cabanes');
 if(!sub||!fil)throw Error('Demo covering teacher accounts missing');
 const subj=await pool.query("SELECT subject_id FROM school_subjects WHERE school_id=$1 AND subject_name='Grade 8 Filipino' AND active=TRUE LIMIT 1",[sid]);
 if(!subj.rowCount)throw Error('Filipino subject missing');
 const routes={};
 const app={
  get:(name,...fn)=>{routes['GET '+name]=fn.at(-1);},
  post:(name,...fn)=>{routes['POST '+name]=fn.at(-1);},
  delete:(name,...fn)=>{routes['DELETE '+name]=fn.at(-1);}
 };
 const auth={authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}};
 registerFlexibleScheduleRoutes(app,safePool,auth);
 const invoke=async(method,url,body={},params={},query={})=>{
  let status=200,response;
  const res={status(v){status=v;return this},json(v){response=v;return this}};
  await routes[method+' '+url]({
    auth:{schoolId:sid,userId:admin.rows[0].user_id,role:'SCHOOL_ADMIN'},body,params,query
  },res);
  return {status,response};
 };
 const base={periodId:period.rows[0].period_id,reason:'SEMINAR',notes:'Transaction rollback verification only'};
 const scenarios=[
  ['cancel-week',{...base,type:'CANCEL',startDate:'2026-12-07',endDate:'2026-12-14'},6],
  ['substitute',{...base,type:'SUBSTITUTE',startDate:'2026-12-08',teacherUserId:sub.user_id},1],
  ['replace',{...base,type:'REPLACE',startDate:'2026-12-09',teacherUserId:fil.user_id,subjectId:subj.rows[0].subject_id},1],
  ['reschedule',{...base,type:'RESCHEDULE',startDate:'2026-12-10',startTime:'07:00',endTime:'08:00'},1]
 ];
 const before=await pool.query('SELECT COUNT(*)::int AS n FROM schedule_day_adjustments WHERE school_id=$1',[sid]);
 const results=[];
 for(const [name,payload,expected] of scenarios){
  const result=await invoke('POST','/api/schedule-adjustments',payload);
  results.push({name,status:result.status,dates:result.response?.updated,skipped:result.response?.skipped,error:result.response?.error||null});
  if(result.status!==201||result.response?.updated!==expected)
   throw Error(name+' test failed: '+JSON.stringify(results.at(-1)));
 }
 const get=await invoke('GET','/api/schedule-adjustments',{}, {},{from:'2026-12-07',to:'2026-12-14'});
 if(get.status!==200)throw Error('GET adjustments failed: '+JSON.stringify(get.response));
 const after=await pool.query('SELECT COUNT(*)::int AS n FROM schedule_day_adjustments WHERE school_id=$1',[sid]);
 if(after.rows[0].n!==before.rows[0].n)throw Error('Rollback did not preserve adjustment count');
 console.log('FLEXIBLE_DB_ROLLBACK_SMOKE_PASS',JSON.stringify({results,adjustmentsBefore:before.rows[0].n,adjustmentsAfter:after.rows[0].n}));
}
main().catch(e=>{console.error('FLEXIBLE_DB_ROLLBACK_SMOKE_FAIL',e.message);process.exitCode=1})
 .finally(()=>pool.end());
