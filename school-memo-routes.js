'use strict';
const express=require('express');
const {validHours}=require('./form48-calculations');
const {manilaDate}=require('./staff-lunch-routes');
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES=new Set(['GENERAL','SCHOOL_ADVISORY','SCHEDULE_NOTICE','CLASS_SUSPENSION']);
const AUDIENCES=new Set(['ALL_USERS','SCHOOL_STAFF']);
const MIME=new Set(['application/pdf','image/jpeg','image/png']);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const cleaned=(v,max=160)=>String(v||'').trim().slice(0,max+1);
const decoded=v=>{try{return decodeURIComponent(String(v||''));}catch(_){return '';}};
const validDate=v=>DAY.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
function validMemoDocument(bytes,mime){
 if(!MIME.has(mime)||!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>4194304)return false;
 if(mime==='application/pdf')return bytes.subarray(0,5).toString('ascii')==='%PDF-';
 if(mime==='image/jpeg')return bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}
const DTR_KEYS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
function readTemporaryHours(raw){
 if(!raw)return null;
 try {
  const input=JSON.parse(decoded(raw));
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).length!==4||!Object.keys(input).every(key=>DTR_KEYS.includes(key)))return null;
  const hours=Object.fromEntries(DTR_KEYS.map(key=>[key,String(input[key]||'')]));
  return validHours(hours)?hours:null;
 }catch(_){return null;}
}
function durationDays(from,to){
 return Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000);
}
function memoViewer(auth){
 if(auth?.type==='SCHOOL_USER'&&auth.schoolId&&auth.userId)
  return {kind:'SCHOOL_USER',id:auth.userId,schoolId:auth.schoolId,role:auth.role};
 if(auth?.type==='STUDENT'&&auth.schoolId&&auth.studentAccountId)
  return {kind:'STUDENT',id:auth.studentAccountId,schoolId:auth.schoolId,role:'STUDENT'};
 return null;
}
function canReadMemo(viewer,audience){
 return Boolean(viewer)&&(audience==='ALL_USERS'||(audience==='SCHOOL_STAFF'
  &&viewer.kind==='SCHOOL_USER'&&viewer.role!=='PARENT'));
}
function registerSchoolMemoRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const principal=[authenticateSchoolClient,requireSchoolRoles('PRINCIPAL')];
 const raw=express.raw({type:['application/pdf','image/jpeg','image/png'],limit:'4mb'});
 const fail=(res,e)=>{console.error('School memo:',e.message);return res.status(503).json({error:'School memorandum service is temporarily unavailable.'});};
 function viewerAccess(req,res,next){
  const actor=memoViewer(req.auth);
  if(!actor)return res.status(403).json({error:'A school staff, parent, or registered student account is required.'});
  req.memoViewer=actor;next();
 }
 const read=[authenticateSchoolClient,viewerAccess];
 const privateResponse=res=>res.set('Cache-Control','private, no-store');
 async function findMemo(req,res,id,includeContent=false){
  if(!UUID.test(id)){res.status(400).json({error:'Invalid memorandum ID.'});return null;}
  const a=req.memoViewer;
  const result=await pool.query(
    'SELECT '+(includeContent?'m.content,m.content_type,m.filename,':'')+
    'm.memo_id AS "memoId",m.school_id AS "schoolId",m.audience,m.title,m.archived_at FROM school_memoranda m WHERE m.school_id=$1 AND m.memo_id=$2',
    [a.schoolId,id]);
  const memo=result.rows[0];
  if(!memo||memo.archived_at){res.status(404).json({error:'This memorandum is not available.'});return null;}
  if(!canReadMemo(a,memo.audience)){res.status(403).json({error:'This memorandum is for school personnel only.'});return null;}
  return memo;
 }
 app.get('/api/school-memos',...read,async(req,res)=>{
  privateResponse(res);
  const viewer=req.memoViewer,limit=Math.min(50,Math.max(1,Number.parseInt(req.query?.limit,10)||20));
  try{
   const result=await pool.query(`
    SELECT m.memo_id AS "memoId",m.title,m.summary,m.category,m.audience,
     to_char(m.effective_date,'YYYY-MM-DD') AS "effectiveDate",
     to_char(m.end_date,'YYYY-MM-DD') AS "endDate",
     m.dtr_hours AS "dtrHours",m.filename,
     m.published_at AS "publishedAt",u.display_name AS "publisher",
     a.acknowledged_at AS "acknowledgedAt"
    FROM school_memoranda m
    JOIN school_users u ON u.school_id=m.school_id AND u.user_id=m.published_by
    LEFT JOIN school_memo_acknowledgments a ON a.school_id=m.school_id AND a.memo_id=m.memo_id
     AND a.viewer_kind=$2 AND a.viewer_id=$3
    WHERE m.school_id=$1 AND m.archived_at IS NULL
     AND (m.audience='ALL_USERS' OR ($4::boolean AND m.audience='SCHOOL_STAFF'))
    ORDER BY m.published_at DESC,m.memo_id DESC LIMIT $5`,
    [viewer.schoolId,viewer.kind,viewer.id,
      viewer.kind==='SCHOOL_USER'&&viewer.role!=='PARENT',limit]);
   return res.json({memoranda:result.rows,unacknowledgedInPage:result.rows.filter(x=>!x.acknowledgedAt).length,
    notice:'Acknowledgment is explicit. Delivery and login alone do not establish that a memorandum was read.'});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/school-memos',...principal,raw,async(req,res)=>{
  privateResponse(res);
  const title=cleaned(decoded(req.headers['x-memo-title']),180),summary=cleaned(decoded(req.headers['x-memo-summary']),1200),
    category=String(req.headers['x-memo-category']||'GENERAL').toUpperCase(),
    audience=String(req.headers['x-memo-audience']||'ALL_USERS').toUpperCase(),
    date=String(req.headers['x-memo-effective-date']||'').trim(),
    endDate=String(req.headers['x-memo-end-date']||'').trim(),
    dtrRequested=String(req.headers['x-memo-apply-dtr']||'false')==='true',
    dtrHours=dtrRequested?readTemporaryHours(req.headers['x-memo-dtr-hours']):null,
    type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase(),
    filename=cleaned(decoded(req.headers['x-filename']||'memo.pdf'),160).replace(/[^a-zA-Z0-9 ._()\-]/g,'_');
  if(title.length<5||title.length>180||summary.length>1200||
   !CATEGORIES.has(category)||!AUDIENCES.has(audience)||
   (date&&!validDate(date))||(endDate&&(!validDate(endDate)||!date||endDate<date))||
   (['SCHEDULE_NOTICE','CLASS_SUSPENSION'].includes(category)&&(!date||!endDate))||
   (category==='CLASS_SUSPENSION'&&audience!=='ALL_USERS')||
   (dtrRequested&&(!dtrHours||category!=='SCHEDULE_NOTICE'||
       !date||!endDate||date<manilaDate()||durationDays(date,endDate)>30))||
   (!dtrRequested&&req.headers['x-memo-dtr-hours'])||
   !filename||!validMemoDocument(req.body,type))
   return res.status(400).json({error:'Provide a valid signed memorandum, effective start/end dates for temporary notices, and four chronological DTR hours when adjustment is enabled (start today or later; maximum 31 days; staff DTR only).'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const sha=createHash('sha256').update(req.body).digest('hex');
   if(dtrHours){
    // Serialize concurrent Principal publications for this school. No two live
    // prescribed-hour exceptions may compete for the same day.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['memo-dtr:'+req.auth.schoolId]);
    const overlap=await client.query(`
     SELECT memo_id FROM school_memoranda WHERE school_id=$1
      AND archived_at IS NULL AND dtr_hours IS NOT NULL
      AND effective_date<=$3::date AND end_date>=$2::date LIMIT 1`,
      [req.auth.schoolId,date,endDate]);
    if(overlap.rowCount){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Another active temporary DTR schedule already covers one or more of these dates. Archive or resolve that notice before publishing a conflicting adjustment.',code:'MEMO_DTR_DATE_CONFLICT'});
    }
   }
   const q=await client.query(`
    INSERT INTO school_memoranda(school_id,published_by,title,summary,category,audience,effective_date,end_date,dtr_hours,filename,content_type,content,sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::jsonb,$10,$11,$12,$13)
    RETURNING memo_id AS "memoId",published_at AS "publishedAt"`,
    [req.auth.schoolId,req.auth.userId,title,summary,category,audience,date||null,endDate||null,
     dtrHours?JSON.stringify(dtrHours):null,filename,type,req.body,sha]);
   const id=q.rows[0].memoId;
   // Send durable in-app notifications to active school accounts and, for the
   // ALL_USERS audience, active registered student accounts in this school.
   // No unverified browser push delivery is claimed.
   const staff=await client.query(`
    INSERT INTO user_notifications
      (school_id,recipient_kind,recipient_id,event_key,category,title,body,request_type,request_id,status,action_url)
    SELECT $1,'SCHOOL_USER',u.user_id,'memo:'||$2::text,'SYSTEM',$3,$4,
      'MEMORANDUM',$2::uuid,'PUBLISHED',
      CASE WHEN u.role='PRINCIPAL' THEN '/principal.html?memo='||$2::text
           WHEN u.role='PARENT' THEN '/parent-portal.html?memo='||$2::text
           ELSE '/portal.html?memo='||$2::text END
    FROM school_users u WHERE u.school_id=$1 AND u.active=TRUE
      AND ($5='ALL_USERS' OR u.role<>'PARENT')
    ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING`,
    [req.auth.schoolId,id,'School memorandum: '+title,summary.slice(0,280),audience]);
   let learners={rowCount:0};
   if(audience==='ALL_USERS'){
    learners=await client.query(`
     INSERT INTO user_notifications
       (school_id,recipient_kind,recipient_id,event_key,category,title,body,request_type,request_id,status,action_url)
     SELECT $1,'STUDENT',sa.student_account_id,'memo:'||$2::text,'SYSTEM',$3,$4,
      'MEMORANDUM',$2::uuid,'PUBLISHED','/student-portal.html?memo='||$2::text
     FROM student_accounts sa JOIN students st ON st.school_id=sa.school_id
        AND st.student_id=sa.student_id AND st.active=TRUE
     WHERE sa.school_id=$1 AND sa.active=TRUE
     ON CONFLICT(recipient_kind,recipient_id,event_key) DO NOTHING`,
     [req.auth.schoolId,id,'School memorandum: '+title,summary.slice(0,280)]);
   }
   await client.query(`
    INSERT INTO school_memo_audit(school_id,memo_id,actor_user_id,action,detail)
    VALUES($1,$2,$3,'PUBLISHED',$4::jsonb)`,
    [req.auth.schoolId,id,req.auth.userId,JSON.stringify({category,audience,effectiveDate:date||null,endDate:endDate||null,
      dtrHours,notified:staff.rowCount+learners.rowCount,sha256:sha})]);
   await client.query('COMMIT');
   return res.status(201).json({memoId:id,publishedAt:q.rows[0].publishedAt,
    notifiedAccounts:staff.rowCount+learners.rowCount,
    notice:dtrHours?'Published with date-bounded prescribed DTR hours for school personnel. Actual punches, class timetables, and manual reviews remain unchanged.':'Published as an announcement; no DTR or timetable changes. Delivery does not prove that recipients read the memo.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return fail(res,e);}finally{client.release();}
 });
 app.get('/api/school-memos/:id/file',...read,async(req,res)=>{
  privateResponse(res);
  try{
   const m=await findMemo(req,res,req.params.id,true);if(!m)return;
   res.set('X-Content-Type-Options','nosniff');
   res.set('Content-Type',m.content_type);
   res.set('Content-Disposition','inline; filename="'+String(m.filename).replace(/[^a-zA-Z0-9 ._()\-]/g,'_')+'"');
   return res.send(m.content);
  }catch(e){return fail(res,e);}
 });
 app.post('/api/school-memos/:id/acknowledge',...read,async(req,res)=>{
  privateResponse(res);
  try{
   const m=await findMemo(req,res,req.params.id);if(!m)return;
   const v=req.memoViewer;
   const result=await pool.query(`
    INSERT INTO school_memo_acknowledgments(school_id,memo_id,viewer_kind,viewer_id)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(school_id,memo_id,viewer_kind,viewer_id) DO NOTHING`,
    [v.schoolId,m.memoId,v.kind,v.id]);
   return res.json({acknowledged:true,alreadyAcknowledged:!result.rowCount,
    notice:'Your explicit acknowledgment has been recorded. It does not imply approval of the memo.'});
  }catch(e){return fail(res,e);}
 });
 app.get('/api/school-memos/:id/receipts',...principal,async(req,res)=>{
  privateResponse(res);
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid memorandum ID.'});
  try{
   const result=await pool.query(`
    SELECT m.memo_id,
      (SELECT COUNT(*)::int FROM user_notifications n WHERE n.school_id=m.school_id
       AND n.event_key='memo:'||m.memo_id::text) AS "notifiedAccounts",
      (SELECT COUNT(*)::int FROM school_memo_acknowledgments a
       WHERE a.school_id=m.school_id AND a.memo_id=m.memo_id) AS "acknowledgedAccounts"
    FROM school_memoranda m WHERE m.school_id=$1 AND m.memo_id=$2`,
    [req.auth.schoolId,req.params.id]);
   if(!result.rowCount)return res.status(404).json({error:'Memorandum not found.'});
   const row=result.rows[0];
   return res.json({notifiedAccounts:row.notifiedAccounts,acknowledgedAccounts:row.acknowledgedAccounts,
    notice:'Notified is an in-app inbox record, not proof of screen display. Acknowledged is an explicit user action.'});
  }catch(e){return fail(res,e);}
 });
 app.post('/api/school-memos/:id/archive',...principal,async(req,res)=>{
  privateResponse(res);
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid memorandum ID.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query(`
    UPDATE school_memoranda SET archived_at=NOW(),archived_by=$3
    WHERE school_id=$1 AND memo_id=$2 AND archived_at IS NULL RETURNING memo_id`,
    [req.auth.schoolId,req.params.id,req.auth.userId]);
   if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active memorandum not found.'});}
   await client.query(`INSERT INTO school_memo_audit(school_id,memo_id,actor_user_id,action)
     VALUES($1,$2,$3,'ARCHIVED')`,[req.auth.schoolId,req.params.id,req.auth.userId]);
   await client.query('COMMIT');
   return res.json({archived:true,notice:'Memo is archived, not deleted. Previous delivery and read history remain in the audit ledger.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return fail(res,e);}finally{client.release();}
 });
}
module.exports={registerSchoolMemoRoutes,validMemoDocument,memoViewer,canReadMemo,readTemporaryHours,durationDays};
