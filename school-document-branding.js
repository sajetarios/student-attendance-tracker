'use strict';
const fields={region:120,division:160,address:240,officialSchoolId:40};
const layouts=['AUTO','AGENCY','SCHOOL','DUAL','TEXT'];
const MAX=2*1024*1024;
function parseSettings(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Enter document identity settings.');
 const settings={};
 for(const [key,max] of Object.entries(fields)){
  const value=body[key]??'';
  if(typeof value!=='string'||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw Error('Invalid '+key+' (maximum '+max+' characters).');
  settings[key]=value.trim();
 }
 if(!layouts.includes(body.layout))throw Error('Select a valid logo layout.');
 settings.layout=body.layout;
 if(body.locatorSlipLayout!==undefined){if(!['ANNEX_E','MATI'].includes(body.locatorSlipLayout))throw Error('Select a valid Locator Slip layout.');settings.locatorSlipLayout=body.locatorSlipLayout;}
 return settings;
}
function imageData(buffer,detectLogo){
 const type=detectLogo(buffer);
 return type&&buffer.length<=MAX?'data:'+type.mime+';base64,'+buffer.toString('base64'):null;
}
function parseLogo(value,detectLogo){
 if(value===undefined||value===null)return value;
 if(typeof value!=='string'||value.length>Math.ceil(MAX/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Choose a supported image of up to 2 MB.');
 const b=Buffer.from(value,'base64');
 if(!b.length||b.length>MAX||!detectLogo(b)||b.toString('base64')!==value)throw Error('Choose a valid PNG, JPEG or WebP image.');
 return b;
}
function printableBranding(row,detectLogo){
 const s=row.document_branding||{};
 return {schoolName:row.school_name||'',region:s.region||'',division:s.division||'',address:s.address||'',
  officialSchoolId:s.officialSchoolId||'',layout:layouts.includes(s.layout)?s.layout:'AUTO',
  locatorSlipLayout:s.locatorSlipLayout==='MATI'?'MATI':'ANNEX_E',schoolLogo:imageData(row.logo_data,detectLogo),agencyLogo:imageData(row.document_agency_logo,detectLogo)};
}
function registerDocumentBranding(app,pool,{authenticateSchoolClient,requireSchoolRoles,canCustomizeBranding,detectLogo}){
 const staff=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','PRINCIPAL');
 const admin=requireSchoolRoles('SCHOOL_ADMIN');
 require('./locator-template-pilot').registerLocatorPilot(app,{authenticateSchoolClient,requireSchoolRoles,canCustomizeBranding});
 const select='SELECT school_name,document_branding,logo_data,document_agency_logo FROM schools WHERE school_id=$1 AND active=TRUE';
 app.get('/api/school/document-branding',authenticateSchoolClient,staff,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{
   const q=await pool.query(select,[req.auth.schoolId]);
   if(!q.rows[0])return res.status(404).json({error:'School not found.'});
   return res.json({branding:printableBranding(q.rows[0],detectLogo)});
  }catch(e){console.error('Document branding read:',e.message);return res.status(503).json({error:'Document identity is temporarily unavailable.'});}
 });
 app.put('/api/school/document-branding',authenticateSchoolClient,admin,canCustomizeBranding,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  let settings,logo;
  try{settings=parseSettings(req.body);logo=parseLogo(req.body.agencyLogo,detectLogo);}
  catch(e){return res.status(400).json({error:e.message});}
  try{
   const sql='WITH changed AS (UPDATE schools SET document_branding=document_branding||$2::jsonb, document_agency_logo=CASE WHEN $3::boolean THEN $4::bytea ELSE document_agency_logo END,updated_at=NOW() WHERE school_id=$1 AND active=TRUE RETURNING school_id,school_name,document_branding,logo_data,document_agency_logo), audited AS ('+
   "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) SELECT school_id,'SCHOOL',$5,'SCHOOL_UPDATE_DOCUMENT_BRANDING','school',school_id::text,$6::jsonb FROM changed RETURNING 1) SELECT changed.* FROM changed CROSS JOIN (SELECT count(*) FROM audited) a";
   const q=await pool.query(sql,[req.auth.schoolId,JSON.stringify(settings),logo!==undefined,logo??null,req.auth.userId,
    JSON.stringify({...settings,agencyLogoChanged:logo!==undefined})]);
   if(!q.rows[0])return res.status(404).json({error:'School not found.'});
   return res.json({branding:printableBranding(q.rows[0],detectLogo)});
  }catch(e){console.error('Document branding save:',e.message);return res.status(503).json({error:'Document identity could not be saved.'});}
 });
}
module.exports={parseSettings,parseLogo,printableBranding,registerDocumentBranding};
