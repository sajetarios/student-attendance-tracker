'use strict';
const express=require('express');
const {createHash}=require('node:crypto');
const {dateOk}=require('./staff-leave-policy');
const {manilaDate}=require('./staff-lunch-routes');
const {isFile}=require('./principal-sdo-routes');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MONTH=/^(20\\d{2}|2100)-(0[1-9]|1[0-2])$/;
const root='/api/staff-attendance/admin/form48/signed-archives';
function headerText(req,name,max){
 try{const s=decodeURIComponent(String(req.headers[name]||'')).trim();return s.length>=3&&s.length<=max&&!/[\\u0000-\\u001f\\u007f]/.test(s)?s:null;}catch{return null;}
}
function scope(req){
 const staffUserId=String(req.query?.staffUserId||''),month=String(req.query?.month||'');
 return UUID.test(staffUserId)&&MONTH.test(month)?{staffUserId,month}:null;
}
function parseSignedArchive(req,today=manilaDate()){
 const s=scope(req),reference=headerText(req,'x-approval-reference',120),reason=headerText(req,'x-revision-reason',1000);
 const signedOn=String(req.headers['x-signed-on']||''),v=String(req.headers['x-prior-version']??'');
 if(!s||!reference||!reason||!dateOk(signedOn)||signedOn>today||s.month>=today.slice(0,7)||signedOn.slice(0,7)<s.month||
    !/^(0|[1-9]\\d{0,8})$/.test(v)||req.headers['x-signed-evidence-verified']!=='true'||
    !Buffer.isBuffer(req.body)||req.body.length>4194304||!isFile(req.body,'application/pdf'))return null;
 return {...s,reference,reason,signedOn,priorVersion:Number(v),sha:createHash('sha256').update(req.body).digest('hex')};
}
function registerForm48SignedArchiveRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const protect=res=>res.set('Cache-Control','no-store, private');
 const fail=res=>res.status(503).json({error:'Signed Form 48 archive unavailable.'});
 const metadata='archive_id AS "archiveId",archive_version AS version,approval_reference AS "approvalReference",signed_on::text AS "signedOn",revision_reason AS reason,recorded_at AS "recordedAt",file_sha256 AS sha256,file_size AS "fileSize"';
 app.get(root,...admin,async(req,res)=>{
  protect(res);const s=scope(req);if(!s)return res.status(400).json({error:'Valid employee and month required.'});
  try{
   const r=await pool.query('SELECT '+metadata+' FROM staff_form48_signed_archives WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date ORDER BY archive_version DESC',[req.auth.schoolId,s.staffUserId,s.month+'-01']);
   return res.json({archives:r.rows,notice:'Archived signed paper records are historical evidence, not current recalculations or digital approval.'});
  }catch(e){return fail(res);}
 });
 app.get(root+'/:id',...admin,async(req,res)=>{
  protect(res);if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid archive ID.'});
  try{
   const r=await pool.query('SELECT file_bytes,file_sha256,archive_version,report_month::text FROM staff_form48_signed_archives WHERE school_id=$1 AND archive_id=$2',[req.auth.schoolId,req.params.id]);
   const doc=r.rows[0];if(!doc)return res.status(404).json({error:'Archive not found.'});
   if(createHash('sha256').update(doc.file_bytes).digest('hex')!==doc.file_sha256)return res.status(503).json({error:'Archive integrity check failed.'});
   res.set('Content-Type','application/pdf');res.set('X-Content-Type-Options','nosniff');
   res.set('Content-Disposition','attachment; filename="Form48-'+doc.report_month.slice(0,7)+'-v'+doc.archive_version+'.pdf"');
   return res.send(doc.file_bytes);
  }catch(e){return fail(res);}
 });
 app.post(root,...admin,express.raw({type:'application/pdf',limit:'4mb'}),async(req,res)=>{
  protect(res);const input=parseSignedArchive(req);
  if(!input)return res.status(400).json({error:'Select a completed month and attach a physically signed Form 48 PDF (up to 4 MB), reference, signature date, reason and verified evidence confirmation.'});
  if(input.staffUserId===req.auth.userId)return res.status(403).json({error:'Another authorized records officer must record your own signed DTR.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const employee=await c.query("SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')",[req.auth.schoolId,input.staffUserId]);
   if(!employee.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Employee not found in this school.'});}
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':form48-archive:'+input.staffUserId+':'+input.month]);
   const prior=await c.query('SELECT archive_version FROM staff_form48_signed_archives WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date ORDER BY archive_version DESC LIMIT 1',[req.auth.schoolId,input.staffUserId,input.month+'-01']);
   if((prior.rows[0]?.archive_version||0)!==input.priorVersion){await c.query('ROLLBACK');return res.status(409).json({error:'Archive history changed. Refresh before adding a new signed version.'});}
   const r=await c.query('INSERT INTO staff_form48_signed_archives(school_id,staff_user_id,report_month,archive_version,approval_reference,signed_on,revision_reason,recorded_by_user_id,file_bytes,file_sha256,file_size) VALUES($1,$2,$3::date,$4,$5,$6::date,$7,$8,$9,$10,$11) RETURNING '+metadata,
    [req.auth.schoolId,input.staffUserId,input.month+'-01',input.priorVersion+1,input.reference,input.signedOn,input.reason,req.auth.userId,req.body,input.sha,req.body.length]);
   const saved=r.rows[0];
   await c.query("INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'FORM48_SIGNED_ARCHIVE_ADDED','STAFF_FORM48_ARCHIVE',$3,$4::jsonb)",[req.auth.schoolId,req.auth.userId,saved.archiveId,JSON.stringify({staffUserId:input.staffUserId,month:input.month,version:saved.version,reference:input.reference,sha256:input.sha})]);
   await c.query('COMMIT');return res.status(201).json({archive:saved});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'That signed PDF or archive version already exists.'});return fail(res);}
  finally{c.release();}
 });
}
module.exports={parseSignedArchive,registerForm48SignedArchiveRoutes};
