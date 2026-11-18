'use strict';
// School Admin-controlled prescribed hours, durable across report months.
// This endpoint never writes attendance events or modifies day-review classifications.
const {validHours}=require('./form48-calculations');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SLOTS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
function readEmployeeSchedule(data){
 if(!data||!UUID.test(String(data.staffUserId||''))||
    !Array.isArray(data.workdays)||!data.workdays.length||data.workdays.length>7||
    new Set(data.workdays).size!==data.workdays.length||
    !data.workdays.every(day=>Number.isInteger(day)&&day>=0&&day<=6)||
    !Number.isInteger(data.revision)||data.revision<0)return null;
 const regularHours=Object.fromEntries(SLOTS.map(k=>[k,String(data.regularHours?.[k]||'')]));
 const saturdayHours=Object.fromEntries(SLOTS.map(k=>[k,String(data.saturdayHours?.[k]||'')]));
 const saturdaySelected=data.workdays.includes(6);
 const regularSelected=data.workdays.some(d=>d!==6);
 if((regularSelected&&!validHours(regularHours))||(saturdaySelected&&!validHours(saturdayHours)))return null;
 // Empty optional schedule is represented as {}, never partially specified values.
 const cleanRegular=validHours(regularHours)?regularHours:
  SLOTS.every(k=>!regularHours[k])?{}:null;
 const cleanSaturday=validHours(saturdayHours)?saturdayHours:
  SLOTS.every(k=>!saturdayHours[k])?{}:null;
 if(!cleanRegular||!cleanSaturday)return null;
 return {staffUserId:data.staffUserId,workdays:data.workdays,regularHours:cleanRegular,
  saturdayHours:cleanSaturday,revision:data.revision};
}
async function getEmployeeForm48Schedule(pool,schoolId,staffUserId){
 const result=await pool.query(
  'SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours",'+
  ' revision,updated_at AS "updatedAt" FROM staff_form48_employee_schedules'+
  ' WHERE school_id=$1 AND staff_user_id=$2',[schoolId,staffUserId]);
 return result.rows[0]||null;
}
function registerForm48EmployeeScheduleRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const validateEmployee=async(schoolId,userId)=>{
  const result=await pool.query(
   "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2"+
   " AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')",
   [schoolId,userId]);return Boolean(result.rowCount);
 };
 app.get('/api/staff-attendance/admin/form48/schedule',...admin,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const staffUserId=String(req.query?.staffUserId||'');
  if(!UUID.test(staffUserId))return res.status(400).json({error:'Valid employee required.'});
  try{
   if(!await validateEmployee(req.auth.schoolId,staffUserId))
    return res.status(404).json({error:'Employee not found in this school.'});
   const schedule=await getEmployeeForm48Schedule(pool,req.auth.schoolId,staffUserId);
   return res.json({staffUserId,schedule:schedule||{configured:false,revision:0}});
  }catch(err){console.error('Employee Form 48 schedule read:',err.message);
   return res.status(503).json({error:'Unable to load prescribed work hours.'});}
 });
 app.put('/api/staff-attendance/admin/form48/schedule',...admin,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const input=readEmployeeSchedule(req.body);
  const month=String(req.body?.month||''),monthlyRevision=req.body?.monthlyRevision;
  if(!input)return res.status(400).json({error:'Choose workdays and enter all four prescribed times for each applicable day type. Verify the times are chronological.'});
  if(month&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||
     Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2100||
     !Number.isInteger(monthlyRevision)||monthlyRevision<0))
   return res.status(400).json({error:'Valid report month and review revision are required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const valid=await client.query(
    "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2"+
    " AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER') FOR SHARE",
    [req.auth.schoolId,input.staffUserId]);
   if(!valid.rowCount){await client.query('ROLLBACK');
    return res.status(404).json({error:'Employee not found in this school.'});}
   const updated=await client.query(
    'INSERT INTO staff_form48_employee_schedules'+
    ' (school_id,staff_user_id,workdays,regular_hours,saturday_hours,updated_by_user_id)'+
    ' VALUES($1,$2,$3::smallint[],$4::jsonb,$5::jsonb,$6)'+
    ' ON CONFLICT (school_id,staff_user_id) DO UPDATE SET'+
    ' workdays=EXCLUDED.workdays,regular_hours=EXCLUDED.regular_hours,'+
    ' saturday_hours=EXCLUDED.saturday_hours,updated_by_user_id=EXCLUDED.updated_by_user_id,'+
    ' updated_at=NOW(),revision=staff_form48_employee_schedules.revision+1'+
    ' WHERE staff_form48_employee_schedules.revision=$7 RETURNING revision,updated_at',
    [req.auth.schoolId,input.staffUserId,input.workdays,JSON.stringify(input.regularHours),
     JSON.stringify(input.saturdayHours),req.auth.userId,input.revision]);
   if(!updated.rowCount){await client.query('ROLLBACK');
    return res.status(409).json({error:'This employee schedule was changed in another session. Reload and review before saving.'});}
   // Refresh an existing selected-month draft in the same transaction.
   // Never change its signatories, absence/excusal decisions, or verified punches.
   let updatedMonthRevision=0;
   if(month){
    const existing=await client.query(
     'SELECT revision FROM staff_form48_monthly_reviews WHERE school_id=$1'+
     ' AND staff_user_id=$2 AND report_month=$3::date FOR UPDATE',
     [req.auth.schoolId,input.staffUserId,month+'-01']);
    if(existing.rowCount){
     if(existing.rows[0].revision!==monthlyRevision){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'The selected month was updated in another session. Reload before saving the schedule.'});
     }
     const monthly=await client.query(
      'UPDATE staff_form48_monthly_reviews SET workdays=$4::smallint[],'+
      ' regular_hours=$5::jsonb,saturday_hours=$6::jsonb,'+
      ' revision=revision+1,updated_at=NOW(),updated_by_user_id=$7'+
      ' WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date RETURNING revision',
      [req.auth.schoolId,input.staffUserId,month+'-01',input.workdays,
       JSON.stringify(input.regularHours),JSON.stringify(input.saturdayHours),req.auth.userId]);
     updatedMonthRevision=monthly.rows[0].revision;
    }else if(monthlyRevision!==0){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Selected-month schedule has changed. Reload before saving.'});
    }
   }
   await client.query(
    "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)"+
    " VALUES($1,$2,'FORM48_EMPLOYEE_SCHEDULE_UPDATED','STAFF_FORM48_SCHEDULE',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,input.staffUserId,
     JSON.stringify({revision:updated.rows[0].revision,reportMonth:month||null,
      updatedMonthRevision,workdays:input.workdays,
      regularHours:input.regularHours,saturdayHours:input.saturdayHours})]);
   await client.query('COMMIT');
   return res.json({saved:true,revision:updated.rows[0].revision,monthlyRevision:updatedMonthRevision,
    notice:'Employee prescribed hours saved; this month and future reports will use them unless an authorized monthly override exists. No attendance punches were changed.'});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});
   console.error('Employee Form 48 schedule save:',err.message);
   return res.status(503).json({error:'Unable to save employee work schedule.'});
  }finally{client.release();}
 });
}
module.exports={readEmployeeSchedule,getEmployeeForm48Schedule,registerForm48EmployeeScheduleRoutes};
