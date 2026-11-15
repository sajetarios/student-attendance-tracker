'use strict';
// Full photo approval smoke test, exclusively for ephemeral CI PostgreSQL database.
// Never run against production or a school database.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express'),{Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerPhotoRoutes}=require('../profile-photo-routes');
async function main(){
 assert.ok((process.env.DATABASE_URL||'').endsWith('/school_attendance_test'),
   'Refusing to run against any database other than the disposable CI test database.');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const random=crypto.randomBytes(6).toString('hex');
 const schoolCode='PHOTO'+random,studentId='PHOTO-'+random;
 const photo=Buffer.from('RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00\x00\x00\x00\x00','latin1');
 const original=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const payload={originalMime:'image/png',original:original.toString('base64'),
  cropped:photo.toString('base64'),thumb:photo.toString('base64')};
 let server;
 try{
   const r=await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
     [schoolCode,'Photo Test School']);
   const schoolId=r.rows[0].school_id;
   const d=await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
     [schoolId,'UNASSIGNED','Unassigned']);
   const dept=d.rows[0].department_id;
   const insertUser=async(role,username)=>{
    const u=await pool.query('INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING user_id',
     [schoolId,dept,username,username,'local-fixture-hash',role]);return u.rows[0].user_id;
   };
   const admin=await insertUser('SCHOOL_ADMIN','admin-'+random);
   const teacher=await insertUser('TEACHER','teacher-'+random);
   const parent=await insertUser('PARENT','parent-'+random);
   await pool.query('INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,$3,$4,$5,$6)',
     [schoolId,studentId,'Learner Test','Grade 8','Rizal','09000000000']);
   await pool.query(`INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status)
      VALUES($1,$2,$3,'Parent','APPROVED')`,[schoolId,parent,studentId]);
   const tokens={};
   for(const [role,id] of [['admin',admin],['teacher',teacher],['parent',parent]]){
    const token=createOpaqueToken();tokens[role]=token;
    await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
      VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '1 hour')`,[hashToken(token),schoolId,id]);
   }
   const app=express();
   app.use(express.json({limit:'10mb'}));
   registerPhotoRoutes(app,pool,{authenticateSchoolClient:createAuthMiddleware(pool).authenticateSchoolClient});
   server=await new Promise((resolve,reject)=>{
    const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));srv.on('error',reject);
   });
   const root='http://127.0.0.1:'+server.address().port;
   async function req(method,url,role,body){
    const result=await fetch(root+url,{method,headers:{Authorization:'Bearer '+tokens[role],
      ...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    const contentType=result.headers.get('content-type')||'';
    return {status:result.status,data:contentType.includes('json')?await result.json():await result.arrayBuffer()};
   }
   const request=await req('POST','/api/photos/request/student/'+studentId,'parent',payload);
   assert.equal(request.status,200,JSON.stringify(request.data));
   assert.equal(request.data.status,'PENDING');
   const unseen=await pool.query('SELECT photo_path FROM students WHERE school_id=$1 AND student_id=$2',[schoolId,studentId]);
   assert.equal(unseen.rows[0].photo_path,null,'Pending photo does not replace existing official photo.');
   const denied=await req('GET','/api/photos/requests','parent');
   assert.equal(denied.status,403,'Parent must not view school approval queue.');
   const listed=await req('GET','/api/photos/requests','admin');
   assert.equal(listed.status,200,JSON.stringify(listed.data));
   assert.equal(listed.data.requests.length,1);
   const id=listed.data.requests[0].requestId;
   const thumb=await req('GET','/api/photos/requests/'+id+'/preview','admin');
   assert.equal(thumb.status,200);
   const approved=await req('POST','/api/photos/requests/'+id+'/review','admin',{decision:'APPROVED'});
   assert.equal(approved.status,200,JSON.stringify(approved.data));
   const replay=await req('POST','/api/photos/requests/'+id+'/review','admin',{decision:'APPROVED'});
   assert.equal(replay.status,409);
   const photoRow=await pool.query('SELECT photo_path FROM students WHERE school_id=$1 AND student_id=$2',[schoolId,studentId]);
   assert.equal(photoRow.rows[0].photo_path,'db:official');
   const official=await pool.query("SELECT image_data,original_data FROM official_profile_photos WHERE school_id=$1 AND subject_kind='STUDENT' AND subject_id=$2",[schoolId,studentId]);
   assert.deepEqual(official.rows[0].image_data,photo);
   assert.deepEqual(official.rows[0].original_data,original);
   const rejected=await req('POST','/api/photos/official/student/'+studentId,'teacher',payload);
   assert.equal(rejected.status,403,'Unassigned teacher cannot replace an official learner photo.');
   const staffRequest=await req('POST','/api/photos/self','teacher',payload);
   assert.equal(staffRequest.status,200,JSON.stringify(staffRequest.data));
   assert.equal(staffRequest.data.status,'PENDING');
   const staffPhoto=await pool.query('SELECT teacher_photo_path FROM school_users WHERE school_id=$1 AND user_id=$2',[schoolId,teacher]);
   assert.equal(staffPhoto.rows[0].teacher_photo_path,null);
   const staffList=await req('GET','/api/photos/requests','admin');
   assert.equal(staffList.data.requests.length,1);
   const staffApproved=await req('POST','/api/photos/requests/'+staffList.data.requests[0].requestId+'/review','admin',{decision:'APPROVED'});
   assert.equal(staffApproved.status,200,JSON.stringify(staffApproved.data));
   const staffPicture=await req('GET','/api/photos/me','teacher');
   assert.equal(staffPicture.status,200);
   const parentSelf=await req('POST','/api/photos/self','parent',payload);
   assert.equal(parentSelf.status,200,JSON.stringify(parentSelf.data));
   assert.equal(parentSelf.data.status,'APPROVED');
   assert.equal((await req('GET','/api/photos/me','parent')).status,200);
   console.log('PASS: parent request remains pending, School Admin review, durable images, role restrictions, staff self-request, parent personal photo.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
