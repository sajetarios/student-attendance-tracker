'use strict';
// Freeze the officially approved session against the prescribed hours on that date.
const {validHours}=require('./form48-calculations');
const {getSchoolForm48Defaults,mergeSchoolForm48Defaults}=require('./form48-bulk-routes');
const {getEmployeeForm48Schedule}=require('./form48-employee-schedules');
function dateKey(value){
 if(typeof value==='string')return value.slice(0,10);
 return value instanceof Date&&!Number.isNaN(value.getTime())?value.toISOString().slice(0,10):'';
}
async function certifiedSession(db,schoolId,staffId,date,session){
 if(!['AM','PM'].includes(session))return null;
 const [monthly,defaults,employee,calendar,memos]=await Promise.all([
 db.query('SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours" FROM staff_form48_monthly_reviews WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date',[schoolId,staffId,date.slice(0,7)+'-01']),
 getSchoolForm48Defaults(db,schoolId),getEmployeeForm48Schedule(db,schoolId,staffId),
 db.query('SELECT exception_type FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date',[schoolId,date]),
 db.query(`SELECT dtr_hours AS hours FROM school_memoranda WHERE school_id=$1 AND dtr_hours IS NOT NULL
 AND audience IN ('ALL_USERS','SCHOOL_STAFF') AND category='SCHEDULE_NOTICE'
 AND effective_date<=$2::date AND end_date>=$2::date
 AND (archived_at IS NULL OR (archived_at AT TIME ZONE 'Asia/Manila')::date>$2::date)`,[schoolId,date])]);
 const saved=monthly.rows[0]?{...monthly.rows[0],configured:true}:null;
 const settings=mergeSchoolForm48Defaults(saved,defaults,employee);
 const weekday=new Date(date+'T12:00:00Z').getUTCDay(),exception=calendar.rows[0]?.exception_type;
 if(!settings?.configured||exception==='CLOSED'||(!(settings.workdays||[]).includes(weekday)&&exception!=='OPEN')||memos.rows.length>1)return null;
 if(exception==='SHORTENED_DAY'&&!memos.rows.length)return null;
 const hours=memos.rows[0]?.hours||(weekday===6?settings.saturdayHours:settings.regularHours);
 if(!validHours(hours))return null;
 return {start:hours[session+'_IN'],end:hours[session+'_OUT']};
}
module.exports={dateKey,certifiedSession};
