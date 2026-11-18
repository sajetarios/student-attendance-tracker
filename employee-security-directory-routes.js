'use strict';
// Read-only, school-scoped, server-paginated staff security directory.
// Existing /api/admin/security/accounts endpoint is kept for legacy account-directory consumers.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ROLES=new Set(['ALL','TEACHER','DEPARTMENT_HEAD','GATE_KEEPER']);
const STATUSES=new Set(['ALL','ACTIVE','INACTIVE','LOCKED','PASSWORD_CHANGE']);
const LIMITS=new Set([10,25,50]);
function parseSecurityDirectoryQuery(query={}){
 const search=String(query.search||'').trim();
 const role=String(query.role||'ALL').toUpperCase();
 const status=String(query.status||'ALL').toUpperCase();
 const department=String(query.department||'ALL');
 const rawPage=String(query.page||'1'),rawLimit=String(query.limit||'25');
 if(search.length>120||!ROLES.has(role)||!STATUSES.has(status)||
    (department!=='ALL'&&!UUID.test(department))||
    !/^\d{1,5}$/.test(rawPage)||!/^\d{1,2}$/.test(rawLimit))return null;
 const page=Number(rawPage),limit=Number(rawLimit);
 if(page<1||page>10000||!LIMITS.has(limit))return null;
 return {search,role,status,department,page,limit};
}
const whereSQL=`WHERE su.school_id=$1 AND su.role IN ('TEACHER','DEPARTMENT_HEAD','GATE_KEEPER')
 AND ($2::text='' OR su.display_name ILIKE '%'||$2||'%' OR su.username ILIKE '%'||$2||'%'
   OR COALESCE(d.department_name,'') ILIKE '%'||$2||'%')
 AND ($3::text='ALL' OR su.role=$3)
 AND ($4::uuid IS NULL OR su.department_id=$4::uuid)
 AND ($5::text='ALL' OR
   ($5='INACTIVE' AND su.active=FALSE) OR
   ($5='LOCKED' AND su.active=TRUE AND su.locked_until>NOW()) OR
   ($5='PASSWORD_CHANGE' AND su.active=TRUE AND
     (su.locked_until IS NULL OR su.locked_until<=NOW()) AND su.must_change_password=TRUE) OR
   ($5='ACTIVE' AND su.active=TRUE AND
     (su.locked_until IS NULL OR su.locked_until<=NOW()) AND su.must_change_password=FALSE))`;
const fromSQL=`FROM school_users su
 LEFT JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id `+whereSQL;
function registerEmployeeSecurityDirectoryRoutes(app,pool,{authenticateSchoolClient,requireSchoolAdmin}){
 app.get('/api/admin/security/accounts/paged',authenticateSchoolClient,requireSchoolAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const query=parseSecurityDirectoryQuery(req.query);
  if(!query)return res.status(400).json({error:'Invalid staff account search or page options.'});
  const params=[req.auth.schoolId,query.search,query.role,
    query.department==='ALL'?null:query.department,query.status];
  try{
   const [counts,departments]=await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total '+fromSQL,params),
    pool.query(`SELECT DISTINCT d.department_id AS "departmentId",d.department_name AS "departmentName"
      FROM school_departments d JOIN school_users su ON su.school_id=d.school_id
       AND su.department_id=d.department_id
      WHERE d.school_id=$1 AND su.role IN ('TEACHER','DEPARTMENT_HEAD','GATE_KEEPER')
      ORDER BY d.department_name LIMIT 300`,[req.auth.schoolId])
   ]);
   const total=Number(counts.rows[0]?.total||0);
   const pages=Math.max(1,Math.ceil(total/query.limit));
   const page=Math.min(query.page,pages);
   const rows=await pool.query(`SELECT su.user_id AS "userId",su.username,
    su.display_name AS "displayName",su.role,su.active,
    su.last_login_at AS "lastLoginAt",
    su.failed_login_attempts AS "failedLoginAttempts",
    su.locked_until AS "lockedUntil",su.must_change_password AS "mustChangePassword",
    d.department_name AS "departmentName",
    COALESCE((SELECT COUNT(*)::int FROM user_sessions us
     WHERE us.principal_type='SCHOOL' AND us.school_id=su.school_id
       AND us.school_user_id=su.user_id AND us.revoked_at IS NULL
       AND us.expires_at>NOW()),0) AS "activeSessions"
    `+fromSQL+` ORDER BY su.active DESC,su.display_name,su.username,su.user_id
     LIMIT $6 OFFSET $7`,[...params,query.limit,(page-1)*query.limit]);
   return res.json({accounts:rows.rows,departments:departments.rows,
     total,page,pages,limit:query.limit});
  }catch(error){
   console.error('Paginated staff account security directory:',error.message);
   return res.status(503).json({error:'Unable to load staff account security directory.'});
  }
 });
}
module.exports={parseSecurityDirectoryQuery,registerEmployeeSecurityDirectoryRoutes};
