'use strict';
const {createIpRateLimiter}=require('./request-limiter');
const {validatePushSubscription,vapidConfig,sendWebPush,testPush,hashEndpoint}=require('./parent-web-push');

function registerParentPushRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const parentOnly=[authenticateSchoolClient,requireSchoolRoles('PARENT')];
 const limit=createIpRateLimiter({windowMs:60*60*1000,maxRequests:80,
   message:'Too many push configuration requests. Try again later.'});
 const safePost=(req,res,next)=>{
   const origin=req.get('origin');
   const expected='https://'+req.get('host');
   const local='http://'+req.get('host');
   if(!origin||(origin!==expected&&!(process.env.NODE_ENV!=='production'&&origin===local)))
     return res.status(403).json({error:'Only this Attendigo website may change push settings.'});
   if(!/^application\/json(?:;|$)/i.test(req.get('content-type')||''))
     return res.status(415).json({error:'JSON request required.'});
   next();
 };

 app.get('/api/parent/push/config',...parentOnly,async(req,res)=>{
   const vapid=vapidConfig();
   try{
     const r=await pool.query('SELECT COUNT(*)::int AS count FROM parent_push_subscriptions WHERE school_id=$1 AND parent_user_id=$2 AND active=TRUE',
       [req.auth.schoolId,req.auth.userId]);
     res.set('Cache-Control','private, no-store').json({
       available:!!vapid,publicKey:vapid?.publicKey||null,
       subscribedDevices:r.rows[0]?.count||0
     });
   }catch(error){console.warn('Parent push config unavailable:',error.code||'DB');res.status(503).json({error:'Push settings unavailable.'});}
 });

 app.post('/api/parent/push/subscribe',...parentOnly,limit,safePost,async(req,res)=>{
   if(!vapidConfig())return res.status(503).json({error:'Phone notifications are not configured yet.'});
   let sub;
   try{sub=validatePushSubscription(req.body?.subscription)}
   catch(error){return res.status(400).json({error:error.message})}
   try{
     const counts=await pool.query('SELECT count(*)::int AS count FROM parent_push_subscriptions WHERE school_id=$1 AND parent_user_id=$2 AND active=TRUE',
       [req.auth.schoolId,req.auth.userId]);
     const existing=await pool.query('SELECT parent_user_id,school_id FROM parent_push_subscriptions WHERE endpoint_hash=$1',[sub.endpointHash]);
     if(existing.rowCount&&(String(existing.rows[0].parent_user_id)!==String(req.auth.userId)||
       String(existing.rows[0].school_id)!==String(req.auth.schoolId)))
       return res.status(409).json({error:'This phone is registered to another parent account. Disable that account’s phone notifications first.'});
     if(!existing.rowCount&&counts.rows[0].count>=5)
       return res.status(409).json({error:'Five devices are already registered. Disable one before adding another.'});
     const saved=await pool.query([
       'INSERT INTO parent_push_subscriptions',
       '(school_id,parent_user_id,endpoint,endpoint_hash,p256dh,auth_secret,active)',
       'VALUES($1,$2,$3,$4,$5,$6,TRUE)',
       'ON CONFLICT(endpoint_hash) DO UPDATE SET endpoint=EXCLUDED.endpoint,p256dh=EXCLUDED.p256dh,',
       'auth_secret=EXCLUDED.auth_secret,active=TRUE,updated_at=NOW(),failure_count=0',
       'WHERE parent_push_subscriptions.school_id=EXCLUDED.school_id',
       'AND parent_push_subscriptions.parent_user_id=EXCLUDED.parent_user_id',
       'RETURNING subscription_id'
     ].join(' '),[req.auth.schoolId,req.auth.userId,sub.endpoint,sub.endpointHash,sub.p256dh,sub.authSecret]);
     if(!saved.rowCount)return res.status(409).json({error:'This phone is registered to another account.'});
     res.set('Cache-Control','no-store').status(201).json({subscribed:true});
   }catch(error){console.warn('Parent push subscribe unavailable:',error.code||'DB');res.status(503).json({error:'Could not enable phone notifications.'});}
 });

 app.post('/api/parent/push/unsubscribe',...parentOnly,limit,safePost,async(req,res)=>{
   const endpoint=req.body?.endpoint;
   if(typeof endpoint!=='string'||endpoint.length>2048)return res.status(400).json({error:'Invalid device subscription.'});
   try{
     await pool.query('UPDATE parent_push_subscriptions SET active=FALSE,updated_at=NOW() WHERE school_id=$1 AND parent_user_id=$2 AND endpoint_hash=$3',
       [req.auth.schoolId,req.auth.userId,hashEndpoint(endpoint)]);
     res.set('Cache-Control','no-store').json({subscribed:false});
   }catch(error){console.warn('Parent push unsubscribe unavailable:',error.code||'DB');res.status(503).json({error:'Could not disable phone notifications.'});}
 });

 app.post('/api/parent/push/test',...parentOnly,limit,safePost,async(req,res)=>{
   if(!vapidConfig())return res.status(503).json({error:'Phone notifications are not configured yet.'});
   const endpoint=req.body?.endpoint;
   if(typeof endpoint!=='string'||endpoint.length>2048)return res.status(400).json({error:'Invalid device.'});
   try{
     const found=await pool.query([
       'UPDATE parent_push_subscriptions SET last_test_at=NOW()',
       'WHERE school_id=$1 AND parent_user_id=$2 AND endpoint_hash=$3 AND active=TRUE',
       "AND (last_test_at IS NULL OR last_test_at<NOW()-interval '45 seconds')",
       'RETURNING endpoint,p256dh,auth_secret AS "authSecret",subscription_id'
     ].join(' '),[req.auth.schoolId,req.auth.userId,hashEndpoint(endpoint)]);
     if(!found.rowCount)return res.status(429).json({error:'Device is not subscribed or a test was sent recently. Try again shortly.'});
     const result=await sendWebPush(found.rows[0],testPush());
     if(result.kind==='gone'){
       await pool.query('UPDATE parent_push_subscriptions SET active=FALSE WHERE subscription_id=$1',[found.rows[0].subscription_id]);
       return res.status(410).json({error:'The phone subscription expired. Enable notifications again.'});
     }
     if(result.kind!=='accepted')return res.status(503).json({error:'Push service did not accept the test. Please retry after checking notification permissions.'});
     res.set('Cache-Control','no-store').status(202).json({accepted:true,
       message:'Push service accepted the test. Phone display depends on device settings and connectivity.'});
   }catch(error){console.warn('Parent push test unavailable:',error.code||error.name||'UNKNOWN');res.status(503).json({error:'Could not send test notification.'});}
 });
}
module.exports={registerParentPushRoutes};
