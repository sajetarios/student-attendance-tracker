'use strict';
/**
 * Database-backed photo originals, normalized display images and thumbnails.
 * Official student photos: School Admin / assigned Class Adviser.
 * Official teacher photos: School Admin. Staff self-changes require school review.
 * Parent self-photos are personal; student and parent requests for official
 * learner photos require School Admin or Class Adviser approval.
 */
const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_LIMIT=5*1024*1024;
const isImage=(buffer,mime)=>{
 if(mime==='image/jpeg')return buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
 if(mime==='image/png')return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/webp')return buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
 return false;
};
const normalizedMime=buffer=>isImage(buffer,'image/webp')?'image/webp':isImage(buffer,'image/png')?'image/png':null;
function parsePhoto(body){
 if(!body||typeof body!=='object'||!['image/jpeg','image/png','image/webp'].includes(body.originalMime))
   throw new Error('Choose a JPG, PNG or WebP photo.');
 function read(value,limit,mime){
   if(typeof value!=='string'||!value.length||value.length>Math.ceil(limit*4/3)+16||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(value))throw Error('Photo data is missing or too large.');
   const buffer=Buffer.from(value,'base64');
   if(buffer.length>limit||!isImage(buffer,mime))throw Error('Photo data is not a supported image.');
   return buffer;
 }
 function readNormalized(value,limit){
   if(typeof value!=='string'||!value.length||value.length>Math.ceil(limit*4/3)+16||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(value))throw Error('Photo data is missing or too large.');
   const buffer=Buffer.from(value,'base64');
   if(buffer.length>limit||!normalizedMime(buffer))throw Error('Photo data is not a supported image.');
   return buffer;
 }
 return {original:read(body.original,FILE_LIMIT,body.originalMime),
   cropped:readNormalized(body.cropped,1024*1024),
   thumb:readNormalized(body.thumb,256*1024),
   originalMime:body.originalMime};
}
function sendBuffer(res,data,mime){
 res.setHeader('Content-Type',normalizedMime(data)||mime||'application/octet-stream');
 res.setHeader('Content-Length',String(data.length));
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Content-Disposition','inline');
 return res.end(data);
}
async function readOfficialPhoto(pool,schoolId,kind,id,res){
 const result=await pool.query(
  'SELECT image_data,image_mime FROM official_profile_photos WHERE school_id=$1 AND subject_kind=$2 AND subject_id=$3',
  [schoolId,kind,String(id)]);
 if(!result.rowCount)return false;
 sendBuffer(res,result.rows[0].image_data,result.rows[0].image_mime);
 return true;
}
async function canManageStudent(db,auth,studentId){
 if(auth.type!=='SCHOOL_USER')return false;
 if(auth.role==='SCHOOL_ADMIN'){
   const r=await db.query('SELECT 1 FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE',[auth.schoolId,studentId]);
   return Boolean(r.rowCount);
 }
 if(auth.role!=='TEACHER'||!auth.teacherDesignations?.includes('CLASS_ADVISER'))return false;
 const r=await db.query(`
 SELECT 1 FROM students s WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
   AND EXISTS (
    SELECT 1 FROM class_adviser_assignments ca
    WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3
      AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en
        JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
        WHERE en.school_id=s.school_id AND en.student_id=s.student_id
          AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
        ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
      AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en
        JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
        WHERE en.school_id=s.school_id AND en.student_id=s.student_id
          AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
        ORDER BY en.created_at DESC LIMIT 1),s.section)
    )`,[auth.schoolId,studentId,auth.userId]);
 return Boolean(r.rowCount);
}
async function isLinkedParent(db,schoolId,parentId,studentId){
 const r=await db.query(`SELECT 1 FROM parent_student_links l
  JOIN students s ON s.school_id=l.school_id AND s.student_id=l.student_id AND s.active=TRUE
  WHERE l.school_id=$1 AND l.parent_user_id=$2 AND l.student_id=$3 AND l.status='APPROVED'`,
  [schoolId,parentId,studentId]);return Boolean(r.rowCount);
}
async function storeOfficial(client,schoolId,kind,id,payload,actorId){
 await client.query(`
 INSERT INTO official_profile_photos
  (school_id,subject_kind,subject_id,original_data,image_data,thumb_data,original_mime,image_mime,modified_by_user_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
 ON CONFLICT (school_id,subject_kind,subject_id)
 DO UPDATE SET original_data=excluded.original_data,image_data=excluded.image_data,
   thumb_data=excluded.thumb_data,original_mime=excluded.original_mime,
   image_mime=excluded.image_mime,modified_by_user_id=excluded.modified_by_user_id,modified_at=NOW()`,
  [schoolId,kind,String(id),payload.original,payload.cropped,payload.thumb,payload.originalMime,normalizedMime(payload.cropped),actorId||null]);
 if(kind==='STUDENT')await client.query(`
   UPDATE students SET photo_path='db:official',updated_at=NOW()
   WHERE school_id=$1 AND student_id=$2`,[schoolId,String(id)]);
 if(kind==='STAFF')await client.query(`
   UPDATE school_users SET teacher_photo_path='db:official',updated_at=NOW()
   WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'`,[schoolId,String(id)]);
}
async function audit(client,schoolId,userId,action,kind,id){
 await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
 VALUES($1,'SCHOOL',$2,$3,$4,$5,'{}'::jsonb)`,[schoolId,userId||null,action,kind,String(id)]);
}
function registerPhotoRoutes(app,pool,{authenticateSchoolClient}){
 const authenticated=authenticateSchoolClient;
 function eligible(req){
  return req.auth?.type==='SCHOOL_USER'||req.auth?.type==='STUDENT';
 }
 app.get('/api/photos/me',authenticated,async (req,res)=>{
   if(!eligible(req))return res.status(403).json({error:'No profile photo access.'});
   const kind=req.auth.type==='STUDENT'?'STUDENT':req.auth.role==='PARENT'?'PARENT':'STAFF';
   const id=kind==='STUDENT'?req.auth.studentId:req.auth.userId;
   try {if(await readOfficialPhoto(pool,req.auth.schoolId,kind,id,res))return;
     return res.status(404).end();}
   catch(e){console.error('Profile photo read:',e.message);return res.status(500).end();}
 });
 app.get('/api/photos/my-status',authenticated,async (req,res)=>{
  if(!eligible(req))return res.status(403).json({error:'Not authorized.'});
  const kind=req.auth.type==='STUDENT'?'STUDENT':req.auth.role==='PARENT'?'PARENT':'STAFF';
  const id=kind==='STUDENT'?req.auth.studentId:req.auth.userId;
  try{
    const r=await pool.query(`
     SELECT EXISTS(SELECT 1 FROM official_profile_photos WHERE school_id=$1 AND subject_kind=$2 AND subject_id=$3) AS "hasPhoto",
     EXISTS(SELECT 1 FROM profile_photo_requests WHERE school_id=$1 AND subject_kind=$2 AND subject_id=$3 AND status='PENDING') AS "pending"`,
     [req.auth.schoolId,kind,String(id)]);
    return res.json(r.rows[0]);
  }catch(e){return res.status(500).json({error:'Could not read photo status.'});}
 });
 app.post('/api/photos/official/:kind/:id',authenticated,async (req,res)=>{
  const kind=req.params.kind==='student'?'STUDENT':req.params.kind==='teacher'?'STAFF':null;
  if(req.auth?.type!=='SCHOOL_USER'||!kind)return res.status(403).json({error:'School photo management only.'});
  if(kind==='STAFF'&&(req.auth.role!=='SCHOOL_ADMIN'||!UUID.test(req.params.id)))
   return res.status(403).json({error:'Only School Admin can upload official teacher photos.'});
  if(kind==='STUDENT'&&req.auth.role!=='SCHOOL_ADMIN'&&
      !(req.auth.role==='TEACHER'&&req.auth.teacherDesignations?.includes('CLASS_ADVISER')))
   return res.status(403).json({error:'Only School Admin or an assigned Class Adviser may upload official learner photos.'});
  let photo;
  try{photo=parsePhoto(req.body)}catch(e){return res.status(400).json({error:e.message});}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let found=false;
    if(kind==='STUDENT')found=await canManageStudent(client,req.auth,req.params.id);
    else {const r=await client.query(
      "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE",
      [req.auth.schoolId,req.params.id]);found=Boolean(r.rowCount);}
    if(!found){await client.query('ROLLBACK');return res.status(404).json({error:'Photo subject not found in your authorized school or class.'});}
    await storeOfficial(client,req.auth.schoolId,kind,req.params.id,photo,req.auth.userId);
    await client.query(`UPDATE profile_photo_requests SET status='REJECTED',reviewed_by=$4,reviewed_at=NOW()
      WHERE school_id=$1 AND subject_kind=$2 AND subject_id=$3 AND status='PENDING'`,
      [req.auth.schoolId,kind,String(req.params.id),req.auth.userId]);
    await audit(client,req.auth.schoolId,req.auth.userId,'PHOTO_OFFICIAL_UPLOADED',kind,req.params.id);
    await client.query('COMMIT');
    return res.json({ok:true,status:'APPROVED'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Official photo upload:',e.message);return res.status(500).json({error:'Could not save official photo.'});}
  finally{client.release();}
 });
 // Own photo: a parent can publish a personal avatar; School Admin can set own.
 // All other school-staff roles submit to School Admin for review.
 app.post('/api/photos/self',authenticated,async (req,res)=>{
  if(req.auth?.type!=='SCHOOL_USER'||!['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER','PARENT'].includes(req.auth.role))
   return res.status(403).json({error:'Photo self-service is unavailable for this account.'});
  let photo;try{photo=parsePhoto(req.body)}catch(e){return res.status(400).json({error:e.message});}
  const immediate=req.auth.role==='PARENT'||req.auth.role==='SCHOOL_ADMIN';
  const kind=req.auth.role==='PARENT'?'PARENT':'STAFF';
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(immediate){
      await storeOfficial(client,req.auth.schoolId,kind,req.auth.userId,photo,req.auth.userId);
      await audit(client,req.auth.schoolId,req.auth.userId,'PROFILE_PHOTO_SAVED',kind,req.auth.userId);
    }else {
      // Lock owner row to serialize multiple uploads from different devices.
      await client.query('SELECT user_id FROM school_users WHERE school_id=$1 AND user_id=$2 FOR UPDATE',[req.auth.schoolId,req.auth.userId]);
      await client.query(`UPDATE profile_photo_requests SET status='REJECTED'
        WHERE school_id=$1 AND subject_kind='STAFF' AND subject_id=$2 AND status='PENDING'`,
        [req.auth.schoolId,String(req.auth.userId)]);
      await client.query(`INSERT INTO profile_photo_requests
       (school_id,subject_kind,subject_id,requested_by_user_id,original_data,image_data,thumb_data,original_mime)
       VALUES($1,'STAFF',$2,$3,$4,$5,$6,$7)`,
       [req.auth.schoolId,String(req.auth.userId),req.auth.userId,photo.original,photo.cropped,photo.thumb,photo.originalMime]);
      await audit(client,req.auth.schoolId,req.auth.userId,'PROFILE_PHOTO_REQUESTED',kind,req.auth.userId);
    }
    await client.query('COMMIT');
    return res.json({ok:true,status:immediate?'APPROVED':'PENDING'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Self photo upload:',e.message);return res.status(500).json({error:'Could not save profile photo.'});}
  finally{client.release();}
 });
 app.post('/api/photos/request/student/:studentId',authenticated,async (req,res)=>{
  const id=String(req.params.studentId||'');
  if(id.length>80||!id)return res.status(400).json({error:'Invalid learner.'});
  const student=req.auth?.type==='STUDENT'&&id===req.auth.studentId;
  const parent=req.auth?.type==='SCHOOL_USER'&&req.auth.role==='PARENT';
  if(!student&&!parent)return res.status(403).json({error:'Only the student or linked parent may request a replacement.'});
  let photo;try{photo=parsePhoto(req.body)}catch(e){return res.status(400).json({error:e.message});}
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const match=await client.query('SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE FOR UPDATE',
      [req.auth.schoolId,id]);
    if(!match.rowCount||(parent&&!await isLinkedParent(client,req.auth.schoolId,req.auth.userId,id))){
      await client.query('ROLLBACK');return res.status(403).json({error:'Learner not linked to your account.'});
    }
    await client.query(`UPDATE profile_photo_requests SET status='REJECTED'
     WHERE school_id=$1 AND subject_kind='STUDENT' AND subject_id=$2 AND status='PENDING'`,[req.auth.schoolId,id]);
    await client.query(`INSERT INTO profile_photo_requests
       (school_id,subject_kind,subject_id,requested_by_user_id,requested_by_student_account_id,original_data,image_data,thumb_data,original_mime)
       VALUES($1,'STUDENT',$2,$3,$4,$5,$6,$7,$8)`,
       [req.auth.schoolId,id,parent?req.auth.userId:null,student?req.auth.studentAccountId:null,
        photo.original,photo.cropped,photo.thumb,photo.originalMime]);
    await audit(client,req.auth.schoolId,parent?req.auth.userId:null,'STUDENT_PHOTO_REPLACEMENT_REQUESTED','STUDENT',id);
    await client.query('COMMIT');return res.json({ok:true,status:'PENDING'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Learner photo request:',e.message);return res.status(500).json({error:'Could not submit learner photo.'});}
  finally{client.release();}
 });
 async function allowedReviewer(req,db,row){
  if(req.auth?.type!=='SCHOOL_USER')return false;
  if(req.auth.role==='SCHOOL_ADMIN')return true;
  return row.subject_kind==='STUDENT'&&await canManageStudent(db,req.auth,row.subject_id);
 }
 app.get('/api/photos/requests',authenticated,async(req,res)=>{
  if(req.auth?.type!=='SCHOOL_USER'||!(req.auth.role==='SCHOOL_ADMIN'||
    (req.auth.role==='TEACHER'&&req.auth.teacherDesignations?.includes('CLASS_ADVISER'))))
   return res.status(403).json({error:'School photo review access required.'});
  try{
   const result=await pool.query(`SELECT request_id AS "requestId",subject_kind AS "subjectKind",
       subject_id AS "subjectId",created_at AS "createdAt",
       COALESCE((SELECT full_name FROM students WHERE school_id=r.school_id AND student_id=r.subject_id),
         (SELECT display_name FROM school_users WHERE school_id=r.school_id AND user_id::text=r.subject_id),
         r.subject_id) AS "subjectName"
     FROM profile_photo_requests r WHERE r.school_id=$1 AND r.status='PENDING'
     ORDER BY r.created_at DESC LIMIT 100`,[req.auth.schoolId]);
   const accessible=[];
   for(const row of result.rows)if(await allowedReviewer(req,pool,{subject_kind:row.subjectKind,subject_id:row.subjectId}))
     accessible.push(row);
   return res.json({requests:accessible});
  }catch(e){console.error('Photo review list:',e.message);return res.status(500).json({error:'Could not load photo requests.'});}
 });
 app.get('/api/photos/requests/:requestId/preview',authenticated,async(req,res)=>{
  if(!UUID.test(req.params.requestId))return res.status(404).end();
  try{
   const r=await pool.query(`SELECT subject_kind,subject_id,image_data
     FROM profile_photo_requests WHERE school_id=$1 AND request_id=$2 AND status='PENDING'`,
     [req.auth.schoolId,req.params.requestId]);
   if(!r.rowCount||!await allowedReviewer(req,pool,r.rows[0]))return res.status(404).end();
   return sendBuffer(res,r.rows[0].image_data);
  }catch(e){return res.status(500).end();}
 });
 app.post('/api/photos/requests/:requestId/review',authenticated,async(req,res)=>{
  if(!UUID.test(req.params.requestId)||!['APPROVED','REJECTED'].includes(req.body?.decision))
   return res.status(400).json({error:'Choose Approve or Reject.'});
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const r=await client.query(`SELECT * FROM profile_photo_requests WHERE school_id=$1 AND request_id=$2 FOR UPDATE`,
     [req.auth.schoolId,req.params.requestId]);
   const request=r.rows[0];
   if(!request||request.status!=='PENDING'){await client.query('ROLLBACK');return res.status(409).json({error:'This request was already reviewed.'});}
   if(!await allowedReviewer(req,client,request)||
      (request.requested_by_user_id&&request.requested_by_user_id===req.auth.userId)){
     await client.query('ROLLBACK');return res.status(403).json({error:'You cannot review this photo request.'});
   }
   if(req.body.decision==='APPROVED'){
    // Reject stale subjects (e.g. disabled staff or deleted students).
    let exists;
    if(request.subject_kind==='STUDENT')exists=await client.query('SELECT 1 FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE',
      [req.auth.schoolId,request.subject_id]);
    else exists=await client.query('SELECT 1 FROM school_users WHERE school_id=$1 AND user_id::text=$2 AND active=TRUE AND role <> \'PARENT\'',
      [req.auth.schoolId,request.subject_id]);
    if(!exists.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'The account is no longer active.'});}
    await storeOfficial(client,req.auth.schoolId,request.subject_kind,request.subject_id,{
      original:request.original_data,cropped:request.image_data,thumb:request.thumb_data,originalMime:request.original_mime
    },req.auth.userId);
   }
   await client.query(`UPDATE profile_photo_requests SET status=$3,reviewed_by=$4,reviewed_at=NOW()
      WHERE school_id=$1 AND request_id=$2`,[req.auth.schoolId,req.params.requestId,req.body.decision,req.auth.userId]);
   await audit(client,req.auth.schoolId,req.auth.userId,'PHOTO_REQUEST_'+req.body.decision,request.subject_kind,request.subject_id);
   await client.query('COMMIT');return res.json({ok:true,status:req.body.decision});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Photo review failed:',e.message);return res.status(500).json({error:'Unable to review photo.'});}
  finally{client.release();}
 });
}

/**
 * Platform administrators have a separate identity namespace from school
 * accounts, so their personal photo must use platform authentication/storage.
 * School photo endpoints must never accept a platform bearer token.
 */
function registerPlatformPhotoRoutes(app,pool,{authenticatePlatform,requirePlatformAdmin}){
 const guard=[authenticatePlatform,requirePlatformAdmin];
 app.get('/api/platform/profile-photo',...guard,async(req,res)=>{
  try{
   const photo=await pool.query('SELECT image_data FROM platform_profile_photos WHERE platform_user_id=$1',[req.auth.userId]);
   if(!photo.rowCount)return res.status(404).end();
   return sendBuffer(res,photo.rows[0].image_data);
  }catch(error){
   console.error('Platform profile photo read failed:',error.message);
   return res.status(500).json({error:'Could not load profile photo.'});
  }
 });
 app.post('/api/platform/profile-photo',...guard,async(req,res)=>{
  let photo;
  try{photo=parsePhoto(req.body)}catch(error){return res.status(400).json({error:error.message});}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query(`
    INSERT INTO platform_profile_photos
     (platform_user_id,original_data,image_data,thumb_data,original_mime)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (platform_user_id) DO UPDATE SET
     original_data=EXCLUDED.original_data,
     image_data=EXCLUDED.image_data,
     thumb_data=EXCLUDED.thumb_data,
     original_mime=EXCLUDED.original_mime,
     modified_at=NOW()`,
    [req.auth.userId,photo.original,photo.cropped,photo.thumb,photo.originalMime]);
   await client.query(`
    INSERT INTO audit_logs (school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    VALUES (NULL,'PLATFORM',$1,'PLATFORM_PROFILE_PHOTO_SAVED','PLATFORM_USER',$2,'{}'::jsonb)`,
    [req.auth.userId,String(req.auth.userId)]);
   await client.query('COMMIT');
   return res.json({ok:true,status:'APPROVED'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Platform profile photo upload failed:',error.message);
   return res.status(500).json({error:'Could not save profile photo.'});
  }finally{client.release();}
 });
}

module.exports={registerPhotoRoutes,registerPlatformPhotoRoutes,readOfficialPhoto,parsePhoto,canManageStudent};
