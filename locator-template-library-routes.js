'use strict';
const MAX=2*1024*1024;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function parseBlankPdf(value){
 if(typeof value!=='string'||value.length>Math.ceil(MAX/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Choose a blank PDF up to 2 MB.');
 const bytes=Buffer.from(value,'base64');
 if(bytes.length>MAX)throw Error('Choose a blank PDF up to 2 MB.');
 if(!bytes.length||bytes.toString('base64')!==value||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Choose a valid PDF.');
 return bytes;
}
function registerLocatorLibraryRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles,authenticatePlatform,requirePlatformAdmin,canCustomizeBranding}){
 const school=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN'),canCustomizeBranding];
 const platform=[authenticatePlatform,requirePlatformAdmin];
 const cols='request_id AS "requestId",region,division,status,submitted_at AS "submittedAt",reviewed_at AS "reviewedAt"';
 const fail=(res,e)=>{console.error('Locator library:',e.message);return res.status(503).json({error:'Template requests are temporarily unavailable.'});};
 app.get('/api/school/locator-template-request',...school,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{const q=await pool.query('SELECT '+cols+' FROM school_locator_template_requests WHERE school_id=$1',[req.auth.schoolId]);return res.json({request:q.rows[0]||null});}catch(e){return fail(res,e);}
 });
 app.post('/api/school/locator-template-request',...school,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(req.body?.blankConfirmed!==true)return res.status(400).json({error:'Confirm that the PDF is blank and contains no personal details or signatures.'});
  let bytes;try{bytes=parseBlankPdf(req.body?.pdf);}catch(e){return res.status(400).json({error:e.message});}
  try{
   const q=await pool.query('SELECT s.document_branding,r.status FROM schools s LEFT JOIN school_locator_template_requests r ON r.school_id=s.school_id WHERE s.school_id=$1 AND s.active=TRUE',[req.auth.schoolId]);
   if(!q.rowCount)return res.status(404).json({error:'School not found.'});
   const {document_branding:b,status}=q.rows[0],region=String(b?.region||'').trim(),division=String(b?.division||'').trim();
   if(!region||!division)return res.status(422).json({error:'Save the region and schools division in Official document identity first.'});
   if(status==='PENDING')return res.status(409).json({error:'Your existing request is still awaiting review.'});
   // Normalize to the existing raster PDF writer so scripts, attachments and
   // editable PDF actions are never stored or served. Original upload is discarded.
   let pdf;
   try{pdf=await require('./locator-slip-preview').renderLocatorPrintPdf(bytes);}catch(e){
    return res.status(e.code==='PREVIEW_BUSY'?429:422).json({error:e.code==='PREVIEW_BUSY'?e.message:'Choose a readable, unprotected, single-page blank PDF.'});
   }
   if(pdf.length>5*1024*1024)return res.status(422).json({error:'Choose a simpler blank PDF with fewer large images.'});
   const hints=await require('./locator-slip-preview').extractLocatorLabels(bytes);
   const r=await pool.query('INSERT INTO school_locator_template_requests(school_id,region,division,pdf_bytes,recognition_hints) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(school_id) DO UPDATE SET request_id=gen_random_uuid(),region=EXCLUDED.region,division=EXCLUDED.division,pdf_bytes=EXCLUDED.pdf_bytes,recognition_hints=EXCLUDED.recognition_hints,status=\'PENDING\',submitted_at=NOW(),reviewed_at=NULL,reviewed_by=NULL WHERE school_locator_template_requests.status=\'REVIEWED\' RETURNING '+cols,[req.auth.schoolId,region,division,pdf,JSON.stringify(hints)]);
   if(!r.rowCount)return res.status(409).json({error:'Your existing request is still awaiting review.'});
   return res.status(201).json({request:r.rows[0]});
  }catch(e){return fail(res,e);}
 });
 app.get('/api/platform/locator-template-requests',...platform,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{const q=await pool.query('SELECT r.request_id AS "requestId",r.region,r.division,r.status,r.submitted_at AS "submittedAt",r.reviewed_at AS "reviewedAt",s.school_name AS "schoolName" FROM school_locator_template_requests r JOIN schools s ON s.school_id=r.school_id ORDER BY (r.status=\'PENDING\') DESC,r.submitted_at DESC LIMIT 100');return res.json({requests:q.rows});}catch(e){return fail(res,e);}
 });
 app.get('/api/platform/locator-template-requests/:id/pdf',...platform,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid request.'});
  try{const q=await pool.query('SELECT pdf_bytes FROM school_locator_template_requests WHERE request_id=$1',[req.params.id]);if(!q.rowCount)return res.status(404).json({error:'Request not found.'});res.set('X-Content-Type-Options','nosniff');return res.type('application/pdf').attachment('Blank-Locator-Slip.pdf').send(q.rows[0].pdf_bytes);}catch(e){return fail(res,e);}
 });
 app.post('/api/platform/locator-template-requests/:id/review',...platform,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid request.'});
  try{const q=await pool.query("UPDATE school_locator_template_requests SET status='REVIEWED',reviewed_at=NOW(),reviewed_by=$2 WHERE request_id=$1 AND status='PENDING' RETURNING request_id",[req.params.id,req.auth.userId]);if(!q.rowCount)return res.status(409).json({error:'Request is no longer pending.'});return res.json({reviewed:true});}catch(e){return fail(res,e);}
 });
}
module.exports={parseBlankPdf,registerLocatorLibraryRoutes};
