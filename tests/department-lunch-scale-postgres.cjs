'use strict';
// Disposable PostgreSQL only. Synthetic schools, overlapping department circles,
// distinct department-bound presenter grants and real authenticated HTTP redemption.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerStaffLunchRoutes,manilaDate}=require('../staff-lunch-routes');
const dbUrl=process.env.DATABASE_URL;
assert.ok(dbUrl && new URL(dbUrl).pathname==='/school_attendance_test','Refusing load test outside disposable school_attendance_test');
const pool=new Pool({connectionString:dbUrl,max:24,connectionTimeoutMillis:30000});
const position=(lat=9,lon=125)=>({latitude:lat,longitude:lon,accuracyMeters:10,capturedAt:Date.now()});
function stats(values){
 const a=[...values].sort((x,y)=>x-y);
 return {p50Ms:Math.round(a[Math.floor((a.length-1)*.50)]),p95Ms:Math.round(a[Math.floor((a.length-1)*.95)]),maxMs:Math.round(a[a.length-1])};
}
async function main(){
 const app=express();app.use(express.json());
 const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
 registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port,api='/api/staff-attendance/lunch';
 async function call(path,body,token){
  const start=performance.now();
  const r=await fetch(base+api+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),ms:performance.now()-start};
 }
 try{
  for(const count of [10,50,100]){
   const school=randomUUID(),suffix=school.slice(0,8),deps=[],users=[],sessions=[],assignments=[],settings=[];
   await pool.query('INSERT INTO schools(school_id,school_code,school_name) VALUES($1,$2,$3)',[school,'SCALE_'+suffix,'Synthetic isolated scale '+count]);
   for(let i=0;i<count;i++){
    const id=randomUUID(),campus=i%2,latitude=campus?9.02:9,longitude=125;
    deps.push({id,code:'DEPT'+i,name:'Department '+i,campus,latitude,longitude,staff:[]});
   }
   await pool.query(`INSERT INTO school_departments(department_id,school_id,department_code,department_name)
    SELECT x.id,$1,x.code,x.name FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,code text,name text)`,[school,JSON.stringify(deps)]);
   function person(dept,role,name){
    const id=randomUUID(),token=createOpaqueToken();
    users.push({id,dep:dept.id,role,name});
    sessions.push({id,hash:hashToken(token)});
    return {id,token};
   }
   const principal=person(deps[0],'PRINCIPAL','principal');
   for(const [i,d] of deps.entries()){
    d.presenter=person(d,'TEACHER','presenter'+i);
    for(let j=0;j<10;j++)d.staff.push(person(d,'TEACHER','scanner'+i+'_'+j));
    assignments.push({id:randomUUID(),dep:d.id,teacher:d.presenter.id});
   }
   await pool.query(`INSERT INTO school_users(user_id,school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    SELECT x.id,$1,x.dep,x.name,x.name,'synthetic-load-test-no-login',x.role,
      CASE WHEN x.role='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END
    FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,dep uuid,role text,name text)`,[school,JSON.stringify(users)]);
   await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
    SELECT x.hash,'SCHOOL',$1,x.id,NOW()+INTERVAL '20 minutes' FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,hash text)`,[school,JSON.stringify(sessions)]);
   const campuses=[];
   for(let i=0;i<2;i++){
    const created=await call('/campuses',{name:'Campus '+i,latitude:i?9.02:9,longitude:125,radiusMeters:600,evidenceReference:'Synthetic verified campus record '+i,attested:true},principal.token);
    assert.equal(created.status,201,JSON.stringify(created.body));campuses.push(created.body.campusId);
   }
   for(const d of deps)settings.push({key:'staff_lunch_geo_'+d.id,point:{latitude:d.latitude,longitude:d.longitude,radiusMeters:120,campusId:campuses[d.campus]}});
   await pool.query(`INSERT INTO school_settings(school_id,setting_key,setting_value)
    SELECT $1,x.key,x.point FROM jsonb_to_recordset($2::jsonb) AS x(key text,point jsonb)`,[school,JSON.stringify(settings)]);
   await pool.query(`INSERT INTO staff_lunch_presenter_assignments(assignment_id,school_id,presenter_user_id,school_date,dtr_slot,assigned_by_user_id,department_id)
    SELECT x.id,$1,x.teacher,$2::date,'PM_IN',$3,x.dep FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,dep uuid,teacher uuid)`,[school,manilaDate(),principal.id,JSON.stringify(assignments)]);
   const issued=await Promise.all(deps.map(d=>call('/challenges',{slot:'PM_IN',location:position(d.latitude,d.longitude)},d.presenter.token)));
   assert.equal(issued.filter(r=>r.status===201).length,count,JSON.stringify(issued.filter(r=>r.status!==201).slice(0,5)));
   const cross=await call('/redeem',{challengeId:issued[0].body.challengeId,token:issued[0].body.token,location:position(deps[1].latitude,deps[1].longitude)},deps[1].staff[0].token);
   assert.equal(cross.status,403,'Cross-campus redemption must be denied');
   const overlap=await call('/redeem',{challengeId:issued[0].body.challengeId,token:issued[0].body.token,location:position(deps[2].latitude,deps[2].longitude)},deps[2].staff[0].token);
   assert.equal(overlap.status,403,'Overlapping geofence must not grant cross-department access');
   const results=await Promise.all(deps.flatMap((d,i)=>d.staff.map(u=>call('/redeem',{challengeId:issued[i].body.challengeId,token:issued[i].body.token,location:position(d.latitude,d.longitude)},u.token))));
   const verified=results.filter(r=>r.status===201&&r.body.status==='VERIFIED').length;
   console.log(JSON.stringify({departments:count,presenters:count,concurrentRedemptions:count*10,verified,issuanceLatency:stats(issued.map(x=>x.ms)),redemptionLatency:stats(results.map(x=>x.ms)),failures:results.filter(r=>r.status!==201||r.body.status!=='VERIFIED').slice(0,3)}));
   assert.equal(verified,count*10,'All valid redemptions must be verified within existing QR rules');
   const duplicates=await pool.query(`SELECT count(*)::int AS n FROM (
     SELECT staff_user_id,school_date,dtr_slot FROM staff_attendance_events WHERE school_id=$1 AND verification_status='VERIFIED'
     GROUP BY staff_user_id,school_date,dtr_slot HAVING count(*)>1) x`,[school]);
   assert.equal(duplicates.rows[0].n,0);
   const total=await pool.query("SELECT count(*)::int AS n FROM staff_attendance_events WHERE school_id=$1 AND verification_status='VERIFIED'",[school]);
   assert.equal(total.rows[0].n,count*10);
  }
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
