'use strict';
const FEATURE_KEYS = Object.freeze(['student_management','manual_attendance','qr_attendance','parent_portal','timetable','planner','offline_sync','advanced_analytics','sms_notifications','custom_branding']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validFeatures = value => value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>FEATURE_KEYS.includes(k) && typeof value[k]==='boolean');
const validLimits = value => value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>['students','sms_monthly'].includes(k) && Number.isSafeInteger(value[k]) && value[k]>=0);
function registerPlatformPlanRoutes(app,pool,{authenticatePlatform,requirePlatformAdmin}) {
 const guard=[authenticatePlatform,requirePlatformAdmin];
 app.get('/api/platform/plans',...guard,async(_req,res)=>{
  try { const [plans,subscriptions]=await Promise.all([
   pool.query('SELECT plan_id AS "planId",code,name,monthly_price_php AS "monthlyPricePhp",features,limits,active FROM platform_plans ORDER BY monthly_price_php,name'),
   pool.query(`SELECT ss.school_id AS "schoolId",ss.plan_id AS "planId",ss.status,ss.starts_at AS "startsAt",ss.ends_at AS "endsAt",ss.overrides, s.school_name AS "schoolName" FROM school_subscriptions ss JOIN schools s USING(school_id) ORDER BY s.school_name`)
  ]);return res.json({plans:plans.rows,subscriptions:subscriptions.rows});}
  catch(err){console.error('Platform plans read:',err.message);return res.status(500).json({error:'Could not load plans.'});}
 });
 app.post('/api/platform/plans',...guard,async(req,res)=>{
  const {code,name,monthlyPricePhp,features,limits}=req.body||{};
  if(typeof code!=='string'|| !/^[a-z][a-z0-9_]{1,39}$/.test(code)||typeof name!=='string'||name.trim().length<2||name.trim().length>100||
    typeof monthlyPricePhp!=='number'||!Number.isFinite(monthlyPricePhp)||monthlyPricePhp<0||monthlyPricePhp>1000000||!validFeatures(features)||!validLimits(limits))
   return res.status(400).json({error:'Invalid plan fields.'});
  try{const result=await pool.query(`INSERT INTO platform_plans(code,name,monthly_price_php,features,limits) VALUES($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING plan_id AS "planId"`,
   [code,name.trim(),monthlyPricePhp,JSON.stringify(features),JSON.stringify(limits)]);
   return res.status(201).json({planId:result.rows[0].planId});
  }catch(err){if(err.code==='23505')return res.status(409).json({error:'Plan code already exists.'});console.error('Plan create:',err.message);return res.status(500).json({error:'Could not create plan.'});}
 });
 app.patch('/api/platform/plans/:planId',...guard,async(req,res)=>{
  const {name,monthlyPricePhp,features,limits,active}=req.body||{};
  if(!uuid(req.params.planId)||typeof name!=='string'||name.trim().length<2||name.trim().length>100||typeof monthlyPricePhp!=='number'||!Number.isFinite(monthlyPricePhp)||monthlyPricePhp<0||monthlyPricePhp>1000000||!validFeatures(features)||!validLimits(limits)||typeof active!=='boolean')return res.status(400).json({error:'Invalid plan fields.'});
  try{const result=await pool.query(`UPDATE platform_plans SET name=$2,monthly_price_php=$3,features=$4::jsonb,limits=$5::jsonb,active=$6,updated_at=NOW() WHERE plan_id=$1 RETURNING plan_id`,[req.params.planId,name.trim(),monthlyPricePhp,JSON.stringify(features),JSON.stringify(limits),active]);return result.rowCount?res.json({ok:true}):res.status(404).json({error:'Plan not found.'});}
  catch(err){console.error('Plan update:',err.message);return res.status(500).json({error:'Could not update plan.'});}
 });
 app.put('/api/platform/schools/:schoolId/subscription',...guard,async(req,res)=>{
  const {planId,status,endsAt,overrides}=req.body||{};
  if(!uuid(req.params.schoolId)||!uuid(planId)||!['ACTIVE','TRIAL','GRACE','EXPIRED','SUSPENDED'].includes(status)||!validFeatures(overrides)|| (endsAt!==null && (typeof endsAt!=='string'||Number.isNaN(Date.parse(endsAt))||Date.parse(endsAt)<=Date.now())))return res.status(400).json({error:'Invalid subscription settings.'});
  const client=await pool.connect();
  try{await client.query('BEGIN');
   const plan=await client.query('SELECT plan_id FROM platform_plans WHERE plan_id=$1 AND active=TRUE',[planId]);
   if(!plan.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Plan unavailable.'});}
   const result=await client.query(`INSERT INTO school_subscriptions(school_id,plan_id,status,ends_at,overrides) VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT(school_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,ends_at=EXCLUDED.ends_at,overrides=EXCLUDED.overrides,updated_at=NOW()
     RETURNING school_id`,[req.params.schoolId,planId,status,endsAt,JSON.stringify(overrides)]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'PLATFORM',$2,'PLATFORM_UPDATE_SUBSCRIPTION','school',$1::uuid::text,$3::jsonb)`,
    [req.params.schoolId,req.auth.userId,JSON.stringify({planId,status,endsAt,overrides})]);
   await client.query('COMMIT');return res.json({ok:true,schoolId:result.rows[0].school_id});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});console.error('Subscription update:',err.message);return res.status(err.code==='23503'?404:500).json({error:'Could not save subscription.'});}
  finally{client.release();}
 });
 app.get('/api/platform/schools/health',...guard,async(_req,res)=>{
  try{
   const result=await pool.query(`
    SELECT s.school_id AS "schoolId",s.school_name AS "schoolName",s.school_code AS "schoolCode",
      s.active,
      (SELECT COUNT(*)::int FROM students st WHERE st.school_id=s.school_id AND st.active=TRUE) AS "students",
      (SELECT COUNT(*)::int FROM school_users u WHERE u.school_id=s.school_id AND u.active=TRUE) AS "accounts",
      (SELECT MAX(a.created_at) FROM audit_logs a WHERE a.school_id=s.school_id) AS "lastAuditAt",
      ss.status AS "subscriptionStatus",ss.ends_at AS "expiresAt",p.name AS "planName",
      COALESCE((p.limits->>'students')::int,0) AS "studentLimit"
    FROM schools s
    LEFT JOIN school_subscriptions ss ON ss.school_id=s.school_id
    LEFT JOIN platform_plans p ON p.plan_id=ss.plan_id
    ORDER BY s.school_name LIMIT 250`);
   res.set('Cache-Control','no-store').json({schools:result.rows});
  }catch(err){console.error('School health:',err.message);res.status(500).json({error:'Could not load school health.'});}
 });
 app.get('/api/platform/subscriptions/summary',...guard,async(_req,res)=>{
  try{
   const [totals,history]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS "assignedSchools",
      COUNT(*) FILTER(WHERE status='TRIAL')::int AS "trials",
      COUNT(*) FILTER(WHERE status='ACTIVE')::int AS "activeSubscriptions",
      COUNT(*) FILTER(WHERE status IN ('EXPIRED','SUSPENDED') OR (ends_at IS NOT NULL AND ends_at<NOW()))::int AS "needsAttention",
      COUNT(*) FILTER(WHERE ends_at BETWEEN NOW() AND NOW()+INTERVAL '14 days')::int AS "renewingSoon"
      FROM school_subscriptions`),
    pool.query(`SELECT a.created_at AS "createdAt",a.action,a.details,
       s.school_name AS "schoolName",p.display_name AS "actorName"
       FROM audit_logs a LEFT JOIN schools s ON s.school_id=a.school_id
       LEFT JOIN platform_users p ON p.user_id=a.actor_user_id
       WHERE a.actor_type='PLATFORM' AND a.action='PLATFORM_UPDATE_SUBSCRIPTION'
       ORDER BY a.created_at DESC LIMIT 20`)
   ]);
   res.set('Cache-Control','no-store').json({summary:totals.rows[0],history:history.rows});
  }catch(err){console.error('Subscription summary:',err.message);res.status(500).json({error:'Could not load subscription summary.'});}
 });
 app.get('/api/platform/schools/:schoolId/entitlements',...guard,async(req,res)=>{
  if(!uuid(req.params.schoolId))return res.status(400).json({error:'Invalid school.'});
  try{const r=await pool.query(`SELECT p.code,p.features,p.limits,ss.overrides,ss.status,ss.ends_at AS "endsAt" FROM school_subscriptions ss JOIN platform_plans p USING(plan_id) WHERE ss.school_id=$1`,[req.params.schoolId]);
   if(!r.rowCount)return res.json({configured:false,legacyAccess:true});
   const s=r.rows[0];const expired=s.endsAt && new Date(s.endsAt).getTime()<=Date.now();return res.json({configured:true,plan:s.code,status:s.status,expired:!!expired,features:{...s.features,...s.overrides},limits:s.limits});
  }catch(err){console.error('Entitlement read:',err.message);return res.status(500).json({error:'Could not load entitlements.'});}
 });
}
module.exports={registerPlatformPlanRoutes,FEATURE_KEYS,validFeatures,validLimits};
