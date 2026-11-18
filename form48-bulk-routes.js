'use strict';
// School Admin-only Form 48 defaults and approved-leave transcription.
// These records never generate, modify or substitute verified attendance punches.
const {randomUUID}=require('node:crypto');
const {validHours}=require('./form48-calculations');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const TYPES=new Set(['MATERNITY','PATERNITY','SICK','VACATION','OTHER']);
const SLOTS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
function validDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const parsed=new Date(date+'T12:00:00Z');
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}
function cleanHours(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const clean=Object.fromEntries(SLOTS.map(k=>[k,String(value[k]||'')]));
 if(SLOTS.every(k=>!clean[k]))return {};
 return validHours(clean)?clean:null;
}
function readDefaults(data){
 if(!data||!Array.isArray(data.workdays)||data.workdays.length>7||
    new Set(data.workdays).size!==data.workdays.length||
    !data.workdays.every(v=>Number.isInteger(v)&&v>=0&&v<=6))return null;
 const regularHours=cleanHours(data.regularHours),saturdayHours=cleanHours(data.saturdayHours);
 if(regularHours===null||saturdayHours===null)return null;
 const names=['verifiedBy','verifiedPosition','approvedBy','approvedPosition'];
 const signatories=Object.fromEntries(names.map(n=>[n,String(data[n]||'').trim()]));
 if(names.some(n=>signatories[n].length>120))return null;
 if(!Number.isInteger(data.revision)||data.revision<0)return null;
 return {...signatories,workdays:data.workdays,regularHours,saturdayHours,revision:data.revision};
}
function readLeave(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!UUID.test(String(value.staffUserId||'')))return null;
 const startDate=String(value.startDate||''),endDate=String(value.endDate||'');
 const leaveType=String(value.leaveType||''),approvalReference=String(value.approvalReference||'').trim();
 if(!validDate(startDate)||!validDate(endDate)||startDate>endDate||
    (Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000>366||
    !TYPES.has(leaveType)||approvalReference.length<3||approvalReference.length>120)return null;
 return {staffUserId:value.staffUserId,startDate,endDate,leaveType,approvalReference};
}
async function getSchoolForm48Defaults(pool,schoolId){
 const response=await pool.query(
  'SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours",'+
  ' verified_by_name AS "verifiedBy",verified_by_position AS "verifiedPosition",'+
  ' approved_by_name AS "approvedBy",approved_by_position AS "approvedPosition",'+
  ' revision FROM staff_form48_school_defaults WHERE school_id=$1',[schoolId]);
 return response.rows[0]||null;
}
function mergeSchoolForm48Defaults(saved,defaults){
 if(!defaults)return saved;
 const effective=saved||{configured:validHours(defaults.regularHours),revision:0,dayReviews:{}};
 return {...effective,
  workdays:saved?.configured?saved.workdays:defaults.workdays,
  regularHours:validHours(effective.regularHours)?effective.regularHours:defaults.regularHours,
  saturdayHours:validHours(effective.saturdayHours)?effective.saturdayHours:defaults.saturdayHours,
  verifiedBy:effective.verifiedBy||defaults.verifiedBy,
  verifiedPosition:effective.verifiedPosition||defaults.verifiedPosition,
  approvedBy:effective.approvedBy||defaults.approvedBy,
  approvedPosition:effective.approvedPosition||defaults.approvedPosition};
}
function monthBounds(month){
 const [year,mm]=month.split('-').map(Number);
 return [month+'-01',mm===12?(year+1)+'-01-01':year+'-'+String(mm+1).padStart(2,'0')+'-01'];
}
function registerForm48BulkRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const noStore=res=>res.set('Cache-Control','private, no-store');
 app.get('/api/staff-attendance/admin/form48/defaults',...admin,async(req,res)=>{
  noStore(res);
  try{
   const defaults=await getSchoolForm48Defaults(pool,req.auth.schoolId);
   return res.json({defaults:defaults||{workdays:[1,2,3,4,5],regularHours:{},
    saturdayHours:{},verifiedBy:'',verifiedPosition:'',approvedBy:'',approvedPosition:'',revision:0}});
  }catch(err){console.error('Form 48 defaults read:',err.message);return res.status(503).json({error:'School defaults unavailable.'});}
 });
 app.put('/api/staff-attendance/admin/form48/defaults',...admin,async(req,res)=>{
  noStore(res);
  const input=readDefaults(req.body);
  if(!input)return res.status(400).json({error:'Valid school work hours, signatories, and revision required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const saved=await client.query(
    'INSERT INTO staff_form48_school_defaults'+
    ' (school_id,workdays,regular_hours,saturday_hours,verified_by_name,verified_by_position,'+
    ' approved_by_name,approved_by_position,updated_by_user_id)'+
    ' VALUES($1,$2::smallint[],$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9)'+
    ' ON CONFLICT (school_id) DO UPDATE SET workdays=EXCLUDED.workdays,'+
    ' regular_hours=EXCLUDED.regular_hours,saturday_hours=EXCLUDED.saturday_hours,'+
    ' verified_by_name=EXCLUDED.verified_by_name,verified_by_position=EXCLUDED.verified_by_position,'+
    ' approved_by_name=EXCLUDED.approved_by_name,approved_by_position=EXCLUDED.approved_by_position,'+
    ' updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW(),'+
    ' revision=staff_form48_school_defaults.revision+1'+
    ' WHERE staff_form48_school_defaults.revision=$10 RETURNING revision',
    [req.auth.schoolId,input.workdays,JSON.stringify(input.regularHours),
     JSON.stringify(input.saturdayHours),input.verifiedBy,input.verifiedPosition,
     input.approvedBy,input.approvedPosition,req.auth.userId,input.revision]);
   if(!saved.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'School defaults were changed by another administrator. Reload and retry.'});}
   await client.query(
    "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)"+
    " VALUES($1,$2,'FORM48_SCHOOL_DEFAULTS_UPDATED','SCHOOL',$1,$3::jsonb)",
    [req.auth.schoolId,req.auth.userId,JSON.stringify({revision:saved.rows[0].revision,
     hasSignatories:Boolean(input.verifiedBy&&input.approvedBy)})]);
   await client.query('COMMIT');
   return res.json({saved:true,revision:saved.rows[0].revision,notice:'Printed names are not electronic approvals.'});
  }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Form 48 defaults save:',err.message);
   return res.status(503).json({error:'Unable to save school defaults.'});
  }finally{client.release();}
 });
 app.get('/api/staff-attendance/admin/form48/leaves',...admin,async(req,res)=>{
  noStore(res);
  const month=String(req.query?.month||''),staffUserId=String(req.query?.staffUserId||'');
  if(!MONTH.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2100||
     (staffUserId&&!UUID.test(staffUserId)))return res.status(400).json({error:'Valid month and optional employee required.'});
  const [from,to]=monthBounds(month);
  try{
   const rows=await pool.query(
    'SELECT l.leave_id AS "leaveId",l.staff_user_id AS "staffUserId",'+
    ' s.display_name AS "displayName",l.leave_type AS "leaveType",'+
    ' to_char(l.start_date,\'YYYY-MM-DD\') AS "startDate",'+
    ' to_char(l.end_date,\'YYYY-MM-DD\') AS "endDate",l.approval_reference AS "approvalReference"'+
    ' FROM staff_form48_approved_leaves l JOIN school_users s'+
    ' ON s.school_id=l.school_id AND s.user_id=l.staff_user_id'+
    ' WHERE l.school_id=$1 AND l.revoked_at IS NULL AND l.start_date<$3::date'+
    ' AND l.end_date>=$2::date AND ($4::uuid IS NULL OR l.staff_user_id=$4::uuid)'+
    ' ORDER BY l.start_date,l.staff_user_id LIMIT 500',
    [req.auth.schoolId,from,to,staffUserId||null]);
   return res.json({month,leaves:rows.rows});
  }catch(err){console.error('Form 48 leaves read:',err.message);return res.status(503).json({error:'Approved leave records unavailable.'});}
 });
 app.post('/api/staff-attendance/admin/form48/leaves/batch',...admin,async(req,res)=>{
  noStore(res);
  const raw=req.body?.entries;
  if(!Array.isArray(raw)||!raw.length||raw.length>50)return res.status(400).json({error:'Select 1 to 50 approved leave records.'});
  const entries=raw.map(readLeave);
  if(entries.some(e=>!e))return res.status(400).json({error:'Each record needs an employee, valid date range, leave type, and approval reference.'});
  for(const [i,a] of entries.entries()){
   if(entries.slice(i+1).some(b=>a.staffUserId===b.staffUserId&&a.startDate<=b.endDate&&b.startDate<=a.endDate))
    return res.status(400).json({error:'Overlapping leave dates in the same batch for one employee.'});
  }
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const ids=[...new Set(entries.map(e=>e.staffUserId))].sort();
   const employees=await client.query(
    "SELECT user_id FROM school_users WHERE school_id=$1 AND user_id=ANY($2::uuid[])"+
    " AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER') FOR UPDATE",
    [req.auth.schoolId,ids]);
   if(employees.rowCount!==ids.length){
    await client.query('ROLLBACK');
    return res.status(404).json({error:'One or more employees do not belong to this school.'});
   }
   for(const item of entries){
    const collision=await client.query(
     'SELECT leave_id FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2'+
     ' AND revoked_at IS NULL AND start_date<=$4::date AND end_date>=$3::date LIMIT 1',
     [req.auth.schoolId,item.staffUserId,item.startDate,item.endDate]);
    if(collision.rowCount){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Overlapping approved leave already exists for an employee. Review existing leave first.'});
    }
   }
   const created=[];
   for(const item of entries){
    const leaveId=randomUUID();
    await client.query(
     'INSERT INTO staff_form48_approved_leaves'+
     ' (leave_id,school_id,staff_user_id,leave_type,start_date,end_date,approval_reference,recorded_by_user_id)'+
     ' VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8)',
     [leaveId,req.auth.schoolId,item.staffUserId,item.leaveType,item.startDate,item.endDate,
      item.approvalReference,req.auth.userId]);
    await client.query(
     "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)"+
     " VALUES($1,$2,'APPROVED_LEAVE_TRANSCRIBED','STAFF_APPROVED_LEAVE',$3,$4::jsonb)",
     [req.auth.schoolId,req.auth.userId,leaveId,
      JSON.stringify({staffUserId:item.staffUserId,startDate:item.startDate,endDate:item.endDate,
       leaveType:item.leaveType,approvalReference:item.approvalReference})]);
    created.push({leaveId,staffUserId:item.staffUserId});
   }
   await client.query('COMMIT');
   return res.status(201).json({recorded:created.length,created,
    notice:'Approved leave dates were recorded. This does not approve an application or create DTR punches.'});
  }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Form 48 approved leave batch:',err.message);
   return res.status(503).json({error:'Unable to record approved leave; no partial batch was saved.'});
  }finally{client.release();}
 });
 app.post('/api/staff-attendance/admin/form48/leaves/:leaveId/revoke',...admin,async(req,res)=>{
  noStore(res);
  const leaveId=String(req.params.leaveId||''),reason=String(req.body?.reason||'').trim();
  if(!UUID.test(leaveId)||reason.length<5||reason.length>240)
   return res.status(400).json({error:'Valid leave record and correction reason required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const updated=await client.query(
    'UPDATE staff_form48_approved_leaves SET revoked_at=NOW(),revoked_by_user_id=$3'+
    ' WHERE leave_id=$2 AND school_id=$1 AND revoked_at IS NULL RETURNING staff_user_id',
    [req.auth.schoolId,leaveId,req.auth.userId]);
   if(!updated.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active leave record not found.'});}
   await client.query(
    "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)"+
    " VALUES($1,$2,'APPROVED_LEAVE_REVOKED','STAFF_APPROVED_LEAVE',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,leaveId,JSON.stringify({reason,staffUserId:updated.rows[0].staff_user_id})]);
   await client.query('COMMIT');return res.json({revoked:true});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});
   console.error('Form 48 leave revoke:',err.message);return res.status(503).json({error:'Unable to revoke leave record.'});
  }finally{client.release();}
 });
}
module.exports={registerForm48BulkRoutes,getSchoolForm48Defaults,mergeSchoolForm48Defaults,readDefaults,readLeave,validDate};
