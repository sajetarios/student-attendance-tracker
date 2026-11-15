'use strict';
const textOk=(v,n=140)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const dateOk=v=>v==null||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
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
        `INSERT INTO school_operating_days(school_id,weekday,is_operating_day,updated_at,updated_by_user_id)
         VALUES($1,$2,$3,NOW(),$4) ON CONFLICT(school_id,weekday) DO UPDATE
         SET is_operating_day=EXCLUDED.is_operating_day,updated_at=NOW(),updated_by_user_id=EXCLUDED.updated_by_user_id`,
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
        `SELECT t.template_id AS "templateId",t.template_name AS name,t.shift_code AS "shiftCode",t.active,
          to_char(t.effective_from,'YYYY-MM-DD') AS "effectiveFrom",to_char(t.effective_to,'YYYY-MM-DD') AS "effectiveTo",
          COALESCE(json_agg(json_build_object('templatePeriodId',p.template_period_id,'order',p.period_order,
            'label',p.period_label,'startTime',to_char(p.start_time,'HH24:MI'),'endTime',to_char(p.end_time,'HH24:MI'),
            'blockType',p.block_type) ORDER BY p.period_order) FILTER(WHERE p.template_period_id IS NOT NULL),'[]'::json) AS periods
         FROM timetable_templates t LEFT JOIN timetable_template_periods p
          ON p.school_id=t.school_id AND p.template_id=t.template_id
         WHERE t.school_id=$1 AND t.active=TRUE GROUP BY t.template_id ORDER BY t.template_name`,
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
    const orders=periods.map((p,i)=>Number(p.order??i+1));
    if(new Set(orders).size!==orders.length) return res.status(400).json({error:'Each time block must have a unique order number.'});
    const chronological=[...periods].sort((a,b)=>a.startTime.localeCompare(b.startTime));
    for(let i=1;i<chronological.length;i++){
      if(chronological[i].startTime<chronological[i-1].endTime)
        return res.status(400).json({error:'Timetable blocks cannot overlap. Check the start and end times.'});
    }
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const t=await c.query(
        `INSERT INTO timetable_templates(school_id,template_name,shift_code,effective_from,effective_to,created_by_user_id)
         VALUES($1,$2,$3,$4::date,$5::date,$6)
         RETURNING template_id AS "templateId",template_name AS name,shift_code AS "shiftCode",active`,
        [req.auth.schoolId,name.trim(),String(shiftCode).toUpperCase(),effectiveFrom,effectiveTo,req.auth.userId]);
      for(let i=0;i<periods.length;i++){
        const p=periods[i];
        await c.query(
          `INSERT INTO timetable_template_periods(school_id,template_id,period_order,period_label,start_time,end_time,block_type)
           VALUES($1,$2,$3,$4,$5::time,$6::time,$7)`,
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
        `SELECT e.exception_id AS "exceptionId",to_char(e.calendar_date,'YYYY-MM-DD') AS date,e.title,
          e.exception_type AS type,e.notes,to_char(e.dismissal_time,'HH24:MI') AS "dismissalTime",
          COALESCE(array_agg(ep.period_id) FILTER(WHERE ep.period_id IS NOT NULL),'{}') AS "periodIds",
          COALESCE(json_agg(json_build_object('periodId',p.period_id,'periodName',p.period_name,'gradeLevel',p.grade_level,'section',p.section)
            ORDER BY p.grade_level,p.section,p.start_time) FILTER(WHERE p.period_id IS NOT NULL),'[]'::json) AS schedules
         FROM school_calendar_exceptions e
         LEFT JOIN school_calendar_exception_periods ep ON ep.school_id=e.school_id AND ep.exception_id=e.exception_id
         LEFT JOIN class_periods p ON p.school_id=ep.school_id AND p.period_id=ep.period_id
         WHERE e.school_id=$1 AND e.calendar_date BETWEEN $2::date AND $3::date
         GROUP BY e.exception_id ORDER BY e.calendar_date`,
        [req.auth.schoolId,from,to]);res.json({exceptions:r.rows});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not load calendar exceptions.'});}
  });
  app.post('/api/scheduling-config/calendar-exceptions',authenticateSchoolClient,admin,async(req,res)=>{
    const {date,title,type,notes=null,dismissalTime=null,periodIds=[]}=req.body||{};
    const kind=String(type||'').toUpperCase(),allowed=['CLOSED','OPEN','SPECIAL_CLASS','SHORTENED_DAY'];
    if(!dateOk(date)||!date||!textOk(title)||!allowed.includes(kind)||!Array.isArray(periodIds)||periodIds.length>200||(notes!=null&&(typeof notes!=='string'||notes.length>500))||
      (kind==='SHORTENED_DAY'?!timeOk(dismissalTime):Boolean(dismissalTime))||
      (['OPEN','SPECIAL_CLASS'].includes(kind)&&!periodIds.length)||
      (!['OPEN','SPECIAL_CLASS'].includes(kind)&&periodIds.length))
      return res.status(400).json({error:'Choose a valid date and title. Additional operating and special-class days require selected schedules; shortened days require a dismissal time.'});
    const ids=[...new Set(periodIds)];
    if(ids.some(id=>typeof id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id))||ids.length!==periodIds.length)
      return res.status(400).json({error:'One or more selected class schedules are invalid.'});
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      if(ids.length){
        const valid=await c.query('SELECT period_id FROM class_periods WHERE school_id=$1 AND active=TRUE AND period_id=ANY($2::uuid[])',[req.auth.schoolId,ids]);
        if(valid.rowCount!==ids.length){await c.query('ROLLBACK');return res.status(400).json({error:'One or more selected schedules are inactive or belong to another school.'});}
      }
      const saved=await c.query(
        `INSERT INTO school_calendar_exceptions(school_id,calendar_date,title,exception_type,notes,created_by_user_id,dismissal_time)
         VALUES($1,$2::date,$3,$4,$5,$6,$7::time)
         ON CONFLICT(school_id,calendar_date) DO UPDATE SET title=EXCLUDED.title,exception_type=EXCLUDED.exception_type,
          notes=EXCLUDED.notes,dismissal_time=EXCLUDED.dismissal_time,updated_at=NOW()
         RETURNING exception_id AS "exceptionId",to_char(calendar_date,'YYYY-MM-DD') AS date,title,
          exception_type AS type,notes,to_char(dismissal_time,'HH24:MI') AS "dismissalTime"`,
        [req.auth.schoolId,date,title.trim(),kind,notes,dismissalTime,req.auth.userId]);
      await c.query('DELETE FROM school_calendar_exception_periods WHERE school_id=$1 AND exception_id=$2',[req.auth.schoolId,saved.rows[0].exceptionId]);
      for(const id of ids) await c.query('INSERT INTO school_calendar_exception_periods(school_id,exception_id,period_id) VALUES($1,$2,$3)',[req.auth.schoolId,saved.rows[0].exceptionId,id]);
      await c.query('COMMIT');res.status(201).json({exception:saved.rows[0]});
    }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e.message);res.status(500).json({error:'Could not save calendar exception.'});}
    finally{c.release();}
  });
  app.delete('/api/scheduling-config/calendar-exceptions/:exceptionId',authenticateSchoolClient,admin,async(req,res)=>{
    if(!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(req.params.exceptionId))
      return res.status(400).json({error:'Invalid calendar exception.'});
    try{
      const r=await pool.query('DELETE FROM school_calendar_exceptions WHERE school_id=$1 AND exception_id=$2 RETURNING exception_id',[req.auth.schoolId,req.params.exceptionId]);
      if(!r.rowCount)return res.status(404).json({error:'Calendar exception not found.'});
      res.json({ok:true});
    }catch(e){console.error(e.message);res.status(500).json({error:'Could not delete calendar exception.'});}
  });
}
module.exports={registerSchedulingConfigRoutes};
