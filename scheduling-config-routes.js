'use strict';
const textOk=(v,n=140)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const dateOk=v=>v==null||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v));
const timeOk=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function registerSchedulingConfigRoutes(app,pool,auth){
  const {authenticateSchoolClient,requireSchoolRoles}=auth;
  const admin=requireSchoolRoles('SCHOOL_ADMIN');
  const reader=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');

  app.get('/api/scheduling-config/operating-days',authenticateSchoolClient,reader,async(req,res)=>{
    try{
      const r=await pool.query('SELECT weekday,is_operating_day AS "isOperatingDay" FROM school_operating_days WHERE school_id=$1 ORDER BY weekday',[req.auth.schoolId]);
      res.json({days:r.rows});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not load operating days.'});}
  });
  app.put('/api/scheduling-config/operating-days',authenticateSchoolClient,admin,async(req,res)=>{
    const days=req.body?.days;
    if(!Array.isArray(days)||days.length!==7||new Set(days.map(x=>Number(x?.weekday))).size!==7||
      days.some(x=>!Number.isInteger(Number(x?.weekday))||Number(x.weekday)<0||Number(x.weekday)>6||typeof x.isOperatingDay!=='boolean'))
      return res.status(400).json({error:'Provide one operating-day setting for every day, Monday through Sunday.'});
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      for(const d of days) await c.query(
        \`INSERT INTO school_operating_days(school_id,weekday,is_operating_day,updated_at,updated_by_user_id)
         VALUES($1,$2,$3,NOW(),$4) ON CONFLICT(school_id,weekday) DO UPDATE
         SET is_operating_day=EXCLUDED.is_operating_day,updated_at=NOW(),updated_by_user_id=EXCLUDED.updated_by_user_id\`,
        [req.auth.schoolId,Number(d.weekday),d.isOperatingDay,req.auth.userId]);
      await c.query('COMMIT');
      const r=await c.query('SELECT weekday,is_operating_day AS "isOperatingDay" FROM school_operating_days WHERE school_id=$1 ORDER BY weekday',[req.auth.schoolId]);
      res.json({days:r.rows});
    }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e.message);res.status(500).json({error:'Could not save operating days.'});}
    finally{c.release();}
  });
  app.get('/api/scheduling-config/templates',authenticateSchoolClient,reader,async(req,res)=>{
    try{
      const r=await pool.query(
        \`SELECT t.template_id AS "templateId",t.template_name AS name,t.shift_code AS "shiftCode",t.active,
          to_char(t.effective_from,'YYYY-MM-DD') AS "effectiveFrom",to_char(t.effective_to,'YYYY-MM-DD') AS "effectiveTo",
          COALESCE(json_agg(json_build_object('templatePeriodId',p.template_period_id,'order',p.period_order,
            'label',p.period_label,'startTime',to_char(p.start_time,'HH24:MI'),'endTime',to_char(p.end_time,'HH24:MI'),
            'blockType',p.block_type) ORDER BY p.period_order) FILTER(WHERE p.template_period_id IS NOT NULL),'[]'::json) AS periods
         FROM timetable_templates t LEFT JOIN timetable_template_periods p
          ON p.school_id=t.school_id AND p.template_id=t.template_id
         WHERE t.school_id=$1 AND t.active=TRUE GROUP BY t.template_id ORDER BY t.template_name\`,
        [req.auth.schoolId]);
      res.json({templates:r.rows});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not load timetable templates.'});}
  });
  app.post('/api/scheduling-config/templates',authenticateSchoolClient,admin,async(req,res)=>{
    const {name,shiftCode='REGULAR',effectiveFrom=null,effectiveTo=null,periods}=req.body||{};
    const shifts=['REGULAR','MORNING','AFTERNOON','EVENING','WEEKEND','CUSTOM'];
    const blocks=['CLASS','BREAK','LUNCH','HOMEROOM','ADVISORY','OTHER'];
    if(!textOk(name,100)||!shifts.includes(String(shiftCode).toUpperCase())||!dateOk(effectiveFrom)||!dateOk(effectiveTo)||
      (effectiveFrom&&effectiveTo&&effectiveTo<effectiveFrom)||!Array.isArray(periods)||!periods.length||periods.length>100||
      periods.some((p,i)=>!textOk(p?.label,80)||!timeOk(p?.startTime)||!timeOk(p?.endTime)||p.endTime<=p.startTime||
        !Number.isInteger(Number(p?.order??i+1))||!blocks.includes(String(p?.blockType||'CLASS').toUpperCase())))
      return res.status(400).json({error:'Provide a valid template name, date range, and ordered time blocks.'});
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const t=await c.query(
        \`INSERT INTO timetable_templates(school_id,template_name,shift_code,effective_from,effective_to,created_by_user_id)
         VALUES($1,$2,$3,$4::date,$5::date,$6)
         RETURNING template_id AS "templateId",template_name AS name,shift_code AS "shiftCode",active\`,
        [req.auth.schoolId,name.trim(),String(shiftCode).toUpperCase(),effectiveFrom,effectiveTo,req.auth.userId]);
      for(let i=0;i<periods.length;i++){
        const p=periods[i];
        await c.query(
          \`INSERT INTO timetable_template_periods(school_id,template_id,period_order,period_label,start_time,end_time,block_type)
           VALUES($1,$2,$3,$4,$5::time,$6::time,$7)\`,
          [req.auth.schoolId,t.rows[0].templateId,Number(p.order??i+1),p.label.trim(),p.startTime,p.endTime,String(p.blockType||'CLASS').toUpperCase()]);
      }
      await c.query('COMMIT');res.status(201).json({template:t.rows[0]});
    }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e.message);res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'Period order is duplicated in this template.':'Could not create timetable template.'});}
    finally{c.release();}
  });
  app.get('/api/scheduling-config/calendar-exceptions',authenticateSchoolClient,reader,async(req,res)=>{
    const from=req.query.from||new Date().toISOString().slice(0,10),to=req.query.to||from;
    if(!dateOk(from)||!dateOk(to)||!from||!to||to<from)return res.status(400).json({error:'Provide a valid date range.'});
    try{
      const r=await pool.query(
        \`SELECT exception_id AS "exceptionId",to_char(calendar_date,'YYYY-MM-DD') AS date,title,
          exception_type AS type,notes FROM school_calendar_exceptions
         WHERE school_id=$1 AND calendar_date BETWEEN $2::date AND $3::date ORDER BY calendar_date\`,
        [req.auth.schoolId,from,to]);res.json({exceptions:r.rows});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not load calendar exceptions.'});}
  });
  app.post('/api/scheduling-config/calendar-exceptions',authenticateSchoolClient,admin,async(req,res)=>{
    const {date,title,type,notes=null}=req.body||{},allowed=['CLOSED','OPEN','SPECIAL_CLASS','SHORTENED_DAY'];
    if(!dateOk(date)||!date||!textOk(title)||!allowed.includes(String(type).toUpperCase()))
      return res.status(400).json({error:'Choose a valid date, title, and calendar exception type.'});
    try{
      const r=await pool.query(
        \`INSERT INTO school_calendar_exceptions(school_id,calendar_date,title,exception_type,notes,created_by_user_id)
         VALUES($1,$2::date,$3,$4,$5,$6) ON CONFLICT(school_id,calendar_date) DO UPDATE
         SET title=EXCLUDED.title,exception_type=EXCLUDED.exception_type,notes=EXCLUDED.notes,updated_at=NOW()
         RETURNING exception_id AS "exceptionId",to_char(calendar_date,'YYYY-MM-DD') AS date,title,
          exception_type AS type,notes\`,
        [req.auth.schoolId,date,title.trim(),String(type).toUpperCase(),notes,req.auth.userId]);
      res.status(201).json({exception:r.rows[0]});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not save calendar exception.'});}
  });
}
module.exports={registerSchedulingConfigRoutes};
