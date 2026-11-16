'use strict';
// Entitlement checks are server-side; unassigned legacy schools retain their access.
function requireSchoolFeature(pool, feature) {
 return async (req,res,next) => {
  if(!req.auth?.schoolId)return res.status(401).json({error:'School authentication required.'});
  try {
   const r=await pool.query(`SELECT p.features,ss.overrides,ss.status,ss.ends_at
     FROM school_subscriptions ss JOIN platform_plans p ON p.plan_id=ss.plan_id
     WHERE ss.school_id=$1`,[req.auth.schoolId]);
   if(!r.rowCount)return next(); // Existing schools must not be locked out during rollout.
   const row=r.rows[0];
   const allowed=Object.hasOwn(row.overrides,feature)?row.overrides[feature]:row.features[feature];
   if(allowed!==true)return res.status(403).json({error:'This feature is not included in your school subscription.',feature});
   if(['EXPIRED','SUSPENDED'].includes(row.status)||(row.ends_at && new Date(row.ends_at).getTime()<=Date.now()))
    return res.status(403).json({error:'This subscription needs renewal before this feature can be used.',feature});
   return next();
  }catch(err){console.error('Feature access check:',err.message);return res.status(503).json({error:'Feature access temporarily unavailable.'});}
 };
}
module.exports={requireSchoolFeature};
