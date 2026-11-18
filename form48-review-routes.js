'use strict';
const {manilaDate}=require('./staff-lunch-routes');
const {validHours,summarizeForm48}=require('./form48-calculations');
const {registerForm48BulkRoutes,getSchoolForm48Defaults,mergeSchoolForm48Defaults}=require('./form48-bulk-routes');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const ALLOWED_ROLES=['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER'];
function cleanHours(value){
 if(value==null||typeof value!=='object'||Array.isArray(value))return null;
 const allowed=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
 const clean=Object.fromEntries(allowed.map(key=>[key,String(value[key]||'')]));
 if(allowed.every(key=>!clean[key]))return {};
 return validHours(clean)?clean:null;
}
function readBody(req){
 const data=req.body||{},month=String(data.month||''),staffUserId=String(data.staffUserId||'');
 if(!UUID.test(staffUserId)||!MONTH.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2100)return null;
 const workdays=data.workdays,dayReviews=data.dayReviews;
 if(!Array.isArray(workdays)||workdays.length>7||new Set(workdays).size!==workdays.length||
    !workdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6))return null;
 if(!dayReviews||typeof dayReviews!=='object'||Array.isArray(dayReviews)||Object.keys(dayReviews).length>31)return null;
 const daysInMonth=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
 for(const [date,status] of Object.entries(dayReviews)){
  if(!new RegExp('^'+month+'-(0[1-9]|[12][0-9]|3[01])$').test(date)||
      Number(date.slice(8))>daysInMonth||!['ABSENT','EXCUSED'].includes(status))return null;
 }
 const regularHours=cleanHours(data.regularHours),saturdayHours=cleanHours(data.saturdayHours);
 if(regularHours===null||saturdayHours===null)return null;
 const verifiedBy=String(data.verifiedBy||'').trim(),approvedBy=String(data.approvedBy||'').trim();
 const verifiedPosition=String(data.verifiedPosition||'').trim(),approvedPosition=String(data.approvedPosition||'').trim();
 if([verifiedBy,approvedBy,verifiedPosition,approvedPosition].some(text=>text.length>120))return null;
 if(!Number.isInteger(data.revision)||data.revision<0)return null;
 return {month,staffUserId,workdays,regularHours,saturdayHours,
  dayReviews,verifiedBy,approvedBy,verifiedPosition,approvedPosition,revision:data.revision};
}
function registeredReview(row){
 return row?{configured:true,workdays:row.workdays,regularHours:row.regularHours,
  saturdayHours:row.saturdayHours,dayReviews:row.dayReviews,
  verifiedBy:row.verifiedBy,approvedBy:row.approvedBy,
  verifiedPosition:row.verifiedPosition,approvedPosition:row.approvedPosition,revision:row.revision,
  updatedAt:row.updatedAt}:null;
}
function registerForm48ReviewRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 registerForm48BulkRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
 const validQuery=req=>{
  const month=String(req.query?.month||''),staffUserId=String(req.query?.staffUserId||'');
  return MONTH.test(month)&&Number(month.slice(0,4))>=2000&&Number(month.slice(0,4))<=2100&&UUID.test(staffUserId)?{month,staffUserId}:null;
 };
 const monthBounds=month=>{
  const [y,m]=month.split('-').map(Number);
  return {from:month+'-01',to:m===12?(y+1)+'-01-01':y+'-'+String(m+1).padStart(2,'0')+'-01'};
 };
 const lookup=async(client,schoolId,staffUserId,month)=>{
  const found=await client.query(
   'SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours",'+
   ' day_reviews AS "dayReviews",verified_by_name AS "verifiedBy",approved_by_name AS "approvedBy",'+
   ' verified_by_position AS "verifiedPosition",approved_by_position AS "approvedPosition",'+
   ' revision,updated_at AS "updatedAt" FROM staff_form48_monthly_reviews'+
   ' WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date',
   [schoolId,staffUserId,month+'-01']);
  return registeredReview(found.rows[0]);
 };
 const activeEmployee=async(schoolId,staffUserId)=>{
  const r=await pool.query(
   "SELECT display_name FROM school_users WHERE school_id=$1 AND user_id=$2"+
   " AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')",
   [schoolId,staffUserId]);
  return Boolean(r.rowCount);
 };
 app.get('/api/staff-attendance/admin/form48/config',...admin,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const params=validQuery(req);
  if(!params)return res.status(400).json({error:'Valid employee and month required.'});
  try{
   if(!await activeEmployee(req.auth.schoolId,params.staffUserId))
    return res.status(404).json({error:'Employee not found in this school.'});
   const [saved,days,defaults]=await Promise.all([
    lookup(pool,req.auth.schoolId,params.staffUserId,params.month),
    pool.query('SELECT weekday FROM school_operating_days WHERE school_id=$1 AND is_operating_day=TRUE ORDER BY weekday',[req.auth.schoolId]),
    getSchoolForm48Defaults(pool,req.auth.schoolId)
   ]);
   const defaults=days.rows.map(x=>Number(x.weekday));
   return res.json({staffUserId:params.staffUserId,month:params.month,
    review:mergeSchoolForm48Defaults(saved||{configured:false,workdays:defaults,regularHours:{},saturdayHours:{},
     dayReviews:{},verifiedBy:'',approvedBy:'',verifiedPosition:'',approvedPosition:'',revision:0},defaults)});
  }catch(err){console.error('Form48 review read:',err.message);return res.status(503).json({error:'Report settings unavailable.'});}
 });
 app.put('/api/staff-attendance/admin/form48/config',...admin,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const input=readBody(req);
  if(!input)return res.status(400).json({error:'Invalid report settings, signatory names or reviewed dates.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const staff=await client.query(
    "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2"+
    " AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')",
    [req.auth.schoolId,input.staffUserId]);
   if(!staff.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Employee not found in this school.'});}
   const saved=await client.query(
    'INSERT INTO staff_form48_monthly_reviews'+
    ' (school_id,staff_user_id,report_month,workdays,regular_hours,saturday_hours,day_reviews,'+
    ' verified_by_name,approved_by_name,verified_by_position,approved_by_position,updated_by_user_id)'+
    ' VALUES($1,$2,$3::date,$4::smallint[],$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)'+
    ' ON CONFLICT (school_id,staff_user_id,report_month) DO UPDATE SET'+
    ' workdays=EXCLUDED.workdays,regular_hours=EXCLUDED.regular_hours,'+
    ' saturday_hours=EXCLUDED.saturday_hours,day_reviews=EXCLUDED.day_reviews,'+
    ' verified_by_name=EXCLUDED.verified_by_name,approved_by_name=EXCLUDED.approved_by_name,'+
    ' verified_by_position=EXCLUDED.verified_by_position,approved_by_position=EXCLUDED.approved_by_position,'+
    ' updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW(),'+
    ' revision=staff_form48_monthly_reviews.revision+1'+
    ' WHERE staff_form48_monthly_reviews.revision=$13'+
    ' RETURNING revision',
    [req.auth.schoolId,input.staffUserId,input.month+'-01',input.workdays,
     JSON.stringify(input.regularHours),JSON.stringify(input.saturdayHours),
     JSON.stringify(input.dayReviews),input.verifiedBy,input.approvedBy,
     input.verifiedPosition,input.approvedPosition,req.auth.userId,input.revision]);
   if(!saved.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Report settings changed in another session. Reload before saving.'});}
   await client.query(
    "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)"+
    " VALUES($1,$2,'FORM48_DRAFT_UPDATED','STAFF_FORM48_REVIEW',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,input.staffUserId,
     JSON.stringify({month:input.month,revision:saved.rows[0].revision,
      confirmedAbsences:Object.entries(input.dayReviews).filter(([,v])=>v==='ABSENT').map(([d])=>d),
      excusedDays:Object.entries(input.dayReviews).filter(([,v])=>v==='EXCUSED').map(([d])=>d),
      signatoryNamesEntered:Boolean(input.verifiedBy||input.approvedBy),
      signatoryPositionsEntered:Boolean(input.verifiedPosition||input.approvedPosition)})]);
   await client.query('COMMIT');
   return res.json({saved:true,revision:saved.rows[0].revision,
    notice:'Draft names do not constitute actual verification or approval.'});
  }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Form48 review save:',err.message);
   return res.status(503).json({error:'Unable to save reviewed report settings.'});
  }finally{client.release();}
 });
 app.get('/api/staff-attendance/admin/form48/analysis',...admin,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const params=validQuery(req);
  if(!params)return res.status(400).json({error:'Valid employee and month required.'});
  try{
   if(!await activeEmployee(req.auth.schoolId,params.staffUserId))
    return res.status(404).json({error:'Employee not found in this school.'});
   const {from,to}=monthBounds(params.month);
   const [rawSettings,events,calendar,ob,leave,defaults,approvedLeaves]=await Promise.all([
    lookup(pool,req.auth.schoolId,params.staffUserId,params.month),
    pool.query("SELECT to_char(school_date,'YYYY-MM-DD') AS date,dtr_slot AS slot,"+
     " to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time"+
     " FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2"+
     " AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'"+
     " AND school_date >= $3::date AND school_date < $4::date",
     [req.auth.schoolId,params.staffUserId,from,to]),
    pool.query("SELECT to_char(calendar_date,'YYYY-MM-DD') AS date,"+
     " exception_type AS type FROM school_calendar_exceptions"+
     " WHERE school_id=$1 AND calendar_date >= $2::date AND calendar_date < $3::date",
     [req.auth.schoolId,from,to]),
    pool.query("SELECT to_char((starts_at AT TIME ZONE 'Asia/Manila')::date,'YYYY-MM-DD') AS "+
     ' "from", to_char((ends_at AT TIME ZONE \'Asia/Manila\')::date,\'YYYY-MM-DD\') AS "to"'+
     " FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2"+
     " AND status='APPROVED' AND ends_at>=($3::date AT TIME ZONE 'Asia/Manila')"+
     " AND starts_at<($4::date AT TIME ZONE 'Asia/Manila')",
     [req.auth.schoolId,params.staffUserId,from,to]),
    pool.query("SELECT teacher_status, to_char(leave_start_date,'YYYY-MM-DD') AS leave_start_date,"+
     " to_char(expected_return_date,'YYYY-MM-DD') AS expected_return_date FROM school_users"+
     ' WHERE school_id=$1 AND user_id=$2',[req.auth.schoolId,params.staffUserId]),
    getSchoolForm48Defaults(pool,req.auth.schoolId),
    pool.query("SELECT to_char(start_date,'YYYY-MM-DD') AS \"from\","+
     " to_char(end_date,'YYYY-MM-DD') AS \"to\" FROM staff_form48_approved_leaves"+
     " WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL"+
     " AND start_date<$4::date AND end_date>=$3::date",
     [req.auth.schoolId,params.staffUserId,from,to])
   ]);
   const settings=mergeSchoolForm48Defaults(rawSettings,defaults);
   const byDate=new Map();
   for(const item of events.rows){
    if(!byDate.has(item.date))byDate.set(item.date,{date:item.date,slots:{}});
    if(!byDate.get(item.date).slots[item.slot])byDate.get(item.date).slots[item.slot]=item.time;
   }
   const teacher=leave.rows[0];
   const approvedLeave=teacher?.teacher_status==='ON_LEAVE'&&teacher.leave_start_date&&teacher.expected_return_date
    ?{from:teacher.leave_start_date,to:teacher.expected_return_date}:null;
   const analysis=summarizeForm48({
    records:[...byDate.values()],month:params.month,today:manilaDate(),settings,
    calendar:calendar.rows,officialBusiness:ob.rows,leave:approvedLeave,approvedLeaves:approvedLeaves.rows
   });
   return res.json({...analysis,reportMonth:params.month,staffUserId:params.staffUserId,
    signatories:{verifiedBy:settings?.verifiedBy||'',approvedBy:settings?.approvedBy||'',
     verifiedPosition:settings?.verifiedPosition||'',approvedPosition:settings?.approvedPosition||''},
    regularHours:settings?.regularHours||{},saturdayHours:settings?.saturdayHours||{},
    notice:'Only verified punches count. Missing days need an administrator to confirm absences or excusals. Printed names are not electronic signatures.'});
  }catch(err){console.error('Form48 analysis:',err.message);return res.status(503).json({error:'Report calculations unavailable.'});}
 });
}
module.exports={registerForm48ReviewRoutes,readBody};
