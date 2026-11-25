'use strict';
const {createHash}=require('node:crypto');
const {validateMapping}=require('./central-locator-renderer');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash=b=>createHash('sha256').update(b).digest('hex');
const mappingKey=m=>JSON.stringify(Object.fromEntries(Object.keys(m).sort().map(k=>[k,m[k]])));
const proof=(row,m)=>hash(Buffer.concat([Buffer.from(row.request_id+'\n'+mappingKey(m)+'\n'),row.pdf_bytes]));
const scope=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
const privateResponse=(req,res,next)=>{res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');next();};
async function loadCentralTemplate(pool,id,identity){
 if(!UUID.test(id||''))throw Error('Invalid central template selection.');
 const q=await pool.query('SELECT * FROM locator_template_versions WHERE template_id=$1',[id]);
 const r=q.rows[0];
 if(!r||!scope(r.region,identity.region)||!scope(r.division,identity.division)||hash(r.pdf_bytes)!==r.pdf_sha256)throw Error('The selected template is unavailable for this division. Contact your School Admin.');
 return {...r,mapping:validateMapping(r.mapping)};
}
function centralValues(data,identity){
 const start=new Date(data.startsAt),end=new Date(data.endsAt),filed=new Date(data.submittedAt);
 const day=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
 const time=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
 if(![start,end,filed].every(d=>Number.isFinite(+d))||end<=start||day.format(start)!==day.format(end))throw Error('Locator Slips require valid same-day official travel dates.');
 return {name:data.staffName,position:data.position,station:data.schoolName,purpose:data.purpose,destination:data.destination,event:day.format(start)+' | '+time.format(start)+' – '+time.format(end),business:'✓',filed:day.format(filed),region:identity.region,division:identity.division,head:identity.schoolHeadName,headPosition:identity.schoolHeadPosition};
}
function registerCentralLocatorRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles,authenticatePlatform,requirePlatformAdmin,canCustomizeBranding}){
 const platform=[authenticatePlatform,requirePlatformAdmin,privateResponse],school=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN'),canCustomizeBranding,privateResponse];
 const base='/api/platform/locator-template-requests/:id';
 const render=async(req,res,action)=>{
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Invalid template request.'});
  let m;
  if(action!=='blank'){try{m=validateMapping(req.body?.mapping);}catch(e){return res.status(422).json({error:e.message});}}
  try{
   const q=await pool.query('SELECT request_id,region,division,pdf_bytes FROM school_locator_template_requests WHERE request_id=$1',[req.params.id]);
   const row=q.rows[0];if(!row)return res.status(404).json({error:'Request not found.'});
   const renderPdf=require('./locator-slip-preview').renderCentralLocator;
   if(action==='blank')return res.type('image/png').send(await renderPdf(row.pdf_bytes,null));
   if(action==='sample'){
    const pdf=await renderPdf(row.pdf_bytes,m,true);
    res.set('X-Locator-Sample-Proof',proof(row,m));
    return res.type('application/pdf').attachment('Locator-Slip-SAMPLE.pdf').send(pdf);
   }
   if(req.body?.verified!==true||req.body?.divisionConfirmed!==true||req.body?.proof!==proof(row,m))return res.status(422).json({error:'Generate and inspect the sample PDF for this exact mapping before publishing.'});
   // Revalidate the printable sample, then store immutable bytes and mapping.
   await renderPdf(row.pdf_bytes,m,true);
   const result=await pool.query(`WITH published AS (
    INSERT INTO locator_template_versions(source_request_id,region,division,pdf_bytes,pdf_sha256,mapping,published_by)
    SELECT request_id,region,division,pdf_bytes,$2,$3::jsonb,$4 FROM school_locator_template_requests WHERE request_id=$1
    ON CONFLICT(source_request_id) DO NOTHING RETURNING template_id,source_request_id
   ), reviewed AS (
    UPDATE school_locator_template_requests r SET status='REVIEWED',reviewed_at=NOW(),reviewed_by=$4
    FROM published p WHERE r.request_id=p.source_request_id AND r.status='PENDING' RETURNING r.request_id
   ) SELECT template_id AS "templateId" FROM published`,[row.request_id,hash(row.pdf_bytes),mappingKey(m),req.auth.userId]);
   if(!result.rowCount)return res.status(409).json({error:'This request is no longer available or has already been published.'});
   return res.status(201).json(result.rows[0]);
   }catch(e){console.error('Central Locator:',e.message);
   if(e.code==='LOCATOR_FIELD_INVALID')return res.status(422).json({error:e.message,field:e.field,optional:!require('./central-locator-renderer').fields.find(f=>f[0]===e.field)?.[3]});
   return res.status(e.code==='PREVIEW_BUSY'?429:422).json({error:e.code==='PREVIEW_BUSY'?e.message:'Could not prepare the form. Check the page and field placement, then retry.'});}
 };
 app.get(base+'/blank-preview',...platform,(req,res)=>render(req,res,'blank'));
 app.post(base+'/sample',...platform,(req,res)=>render(req,res,'sample'));
 app.post(base+'/publish',...platform,(req,res)=>render(req,res,'publish'));
 app.get('/api/school/locator-templates',...school,async(req,res)=>{
  try{
   const q=await pool.query('SELECT document_branding FROM schools WHERE school_id=$1 AND active=TRUE',[req.auth.schoolId]);
   if(!q.rowCount)return res.status(404).json({error:'School not found.'});
   const b=q.rows[0].document_branding||{};
   const t=await pool.query('SELECT template_id AS "templateId",division,region,published_at AS "publishedAt" FROM locator_template_versions WHERE lower(region)=lower($1) AND lower(division)=lower($2) ORDER BY published_at DESC LIMIT 100',[String(b.region||'').trim(),String(b.division||'').trim()]);
   return res.json({templates:t.rows,selected:b.centralLocatorTemplateId||null});
  }catch(e){console.error('Central Locator list:',e.message);return res.status(503).json({error:'Template library unavailable.'});}
 });
 app.post('/api/school/locator-templates/activate',...school,async(req,res)=>{
  const id=req.body?.templateId;
  if(id!==null&&!UUID.test(id||''))return res.status(400).json({error:'Select a verified template.'});
  try{
   const r=await pool.query(`WITH changed AS (
    UPDATE schools SET document_branding=CASE WHEN $2::uuid IS NULL THEN document_branding-'centralLocatorTemplateId'
    ELSE jsonb_set(document_branding,'{centralLocatorTemplateId}',to_jsonb($2::text),true) END,updated_at=NOW()
    WHERE school_id=$1 AND active=TRUE AND ($2::uuid IS NULL OR EXISTS(
      SELECT 1 FROM locator_template_versions v WHERE v.template_id=$2
      AND lower(v.region)=lower(trim(document_branding->>'region')) AND lower(v.division)=lower(trim(document_branding->>'division'))))
    RETURNING school_id), audited AS (
    INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    SELECT school_id,'SCHOOL',$3,'SCHOOL_ACTIVATE_LOCATOR_TEMPLATE','school',school_id::text,jsonb_build_object('templateId',$2::text) FROM changed RETURNING 1)
    SELECT school_id FROM changed CROSS JOIN (SELECT count(*) FROM audited) a`,[req.auth.schoolId,id,req.auth.userId]);
   if(!r.rowCount)return res.status(404).json({error:'This verified template is not available for your school division.'});
   return res.json({selected:id});
  }catch(e){console.error('Central Locator activation:',e.message);return res.status(503).json({error:'Template selection could not be saved.'});}
 });
}
module.exports={registerCentralLocatorRoutes,loadCentralTemplate,centralValues,proof,scope};
