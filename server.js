'use strict';
require('dotenv').config();

const express = require('express');
const { redirectLeakedCredentials } = require('./credential-url-guard');
const { registerSmsRoutes } = require('./sms-routes');
const { startSmsWorker } = require('./sms-service');
let smsWorker;
const { Pool } = require('pg');
const { primaryPoolOptions, handleIdleClientErrors, singleFlight, createDatabaseReadiness } = require('./db-connection-reliability');
const { runMigrations } = require('./scripts/migrate');
const { runSupabasePreflight } = require('./scripts/supabase-connection-preflight');
const { nextStudentId } = require('./generated-record-ids');
const QRCode = require('qrcode');
const path = require('path');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { sectionKey, gradeKey, inspectName, isSimilar } = require('./section-identity');
const { registerAuthRoutes } = require('./auth-routes');
const { hashPassword, verifyPassword } = require('./auth-security');
const { createAuthMiddleware } = require('./auth-middleware');
const { registerParentRoutes } = require('./parent-routes');
const { registerGuardianRoutes } = require('./guardian-routes');
const { registerStudentRoutes } = require('./student-routes');
const { registerStudentPortalAccountRoutes } = require('./student-portal-account-routes');
const { registerAcademicRoutes } = require('./academic-routes');
const { registerShsRoutes } = require('./shs-academic-routes');
const { registerSpecialProgramRoutes } = require('./special-program-routes');
const { registerDepartmentRoutes } = require('./department-routes');
const { registerSchedulingConfigRoutes } = require('./scheduling-config-routes');
const registerCloudSyncRoutes = require('./cloud-sync-routes');
const processCloudSyncOutbox = registerCloudSyncRoutes.processCloudSyncOutbox;
const { registerAccountRoutes } = require('./account-routes');
const { registerSchoolRoutes } = require('./school-routes');
const { registerPlatformRoutes } = require('./platform-routes');
const { registerPlatformBootstrapRoutes } = require('./platform-bootstrap-routes');
const { registerSchoolAdminRecoveryRoutes } = require('./school-admin-recovery-routes');
const { registerFlexibleScheduleRoutes } = require('./flexible-schedule-routes');
const { registerClassQrRoutes } = require('./class-qr-routes');
const { registerStaffLunchRoutes } = require('./staff-lunch-routes');
const { registerStaffObRoutes } = require('./staff-ob-routes');
const { registerStaffLeaveRoutes } = require('./staff-leave-routes');
const { registerStaffLeaveInboxRoutes } = require('./staff-leave-inbox-routes');
const { registerPrincipalRoutes } = require('./principal-overview-routes');
const { registerPrincipalClassImpactRoutes } = require('./principal-class-impact-routes');
const { getStaffLeaveStatus, gateVisibleLeave } = require('./staff-approved-leave-status');
const { registerDepartmentWorkspaceRoutes } = require('./department-workspace-routes');
const { registerStaffGateDtrRoutes } = require('./staff-gate-dtr-routes');
const { registerGateDtrReviewRoutes } = require('./staff-gate-dtr-review-routes');
const { registerMissingScanRoutes } = require('./missing-scan-routes');
const { registerForm48ReviewRoutes } = require('./form48-review-routes');
const { registerEmployeeSecurityDirectoryRoutes } = require('./employee-security-directory-routes');
const { registerManualAttendanceRoutes } = require('./manual-attendance-routes');
const { teacherRecentClassAttendanceSql } = require('./recent-class-attendance');
const { registerClassFinalizationRoutes } = require('./class-finalization-routes');
const { registerSardoRoutes } = require('./sardo-routes');
const { registerPlannerRoutes } = require('./planner-routes');
const { registerPhotoRoutes, registerPlatformPhotoRoutes, readOfficialPhoto } = require('./profile-photo-routes');
const { registerNotificationRoutes } = require('./notification-routes');
const { registerHelpAiRoutes } = require('./help-ai-routes');
const { registerStartupReadinessRoute } = require('./startup-readiness-route');

const app = express();
const migrationReadOnly = process.env.ATTENDIGO_MIGRATION_MODE === 'read_only';
const supabasePrimary = process.env.ATTENDIGO_PRIMARY_DATABASE === 'supabase';
function configurePrimaryDatabase() {
  if (!supabasePrimary) return { connectionString: process.env.DATABASE_URL };
  const ca = process.env.ATTENDIGO_VERIFIED_SUPABASE_ROOT_CA;
  if (!ca || !ca.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Supabase primary refused: verified certificate was not prepared.');
  }
  const { inspectTarget } = require('./scripts/supabase-connection-preflight');
  const url = process.env.SUPABASE_DATABASE_URL;
  if (inspectTarget(url).status !== 'configured') {
    throw new Error('Supabase primary refused: target is not the approved Attendigo project.');
  }
  const parsed = new URL(url);
  // pg-connection-string overwrites an explicit SSL config when URL has sslmode.
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslrootcert');
  return {
    connectionString: parsed.toString(),
    ssl: { ca, rejectUnauthorized: true }
  };
}
const pool = handleIdleClientErrors(new Pool(primaryPoolOptions(configurePrimaryDatabase(), { supabasePrimary })));
if (migrationReadOnly) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (['GET','HEAD'].includes(req.method) && !req.path.startsWith('/api/')) {
      return next();
    }
    res.set('Cache-Control', 'no-store, private');
    return res.status(503).json({
      error: 'Attendigo is completing secure database maintenance. Your records are safe. Please try again shortly.',
      code: 'DATABASE_MAINTENANCE'
    });
  });
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // Non-disruptive CSP baseline. Inline legacy scripts must be migrated to
  // external nonce-protected modules before strict script-src enforcement.
  res.setHeader('Content-Security-Policy',
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('Content-Security-Policy-Report-Only',
    "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");

  if (req.path.startsWith('/api/') ||
      ['/', '/index.html', '/portal-login.html', '/parent-register.html', '/platform-setup.html',
       '/portal.html', '/principal.html', '/student-portal.html', '/parent-portal.html',
       '/force-password-change.html', '/session-guard.js',
       '/portal.js', '/schedule-form-layout.css', '/schedule-workspace-ui.js'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Browser-only protection. Device/CLI Bearer requests without an auth cookie are
// unaffected. SameSite=Lax alone does not replace an explicit origin check.
const sessionCookiePattern=/(?:^|;\s*)__Host-attendigo-(?:staff|student)=/;
app.use((req,res,next)=>{
 if(['GET','HEAD','OPTIONS'].includes(req.method)||!req.path.startsWith('/api/'))
  return next();
 if(!sessionCookiePattern.test(String(req.headers.cookie||'')))return next();
 const host=String(req.get('host')||'').toLowerCase();
 const origin=String(req.get('origin')||'');
 const fetchSite=String(req.get('sec-fetch-site')||'');
 if(fetchSite&&fetchSite!=='same-origin')
  return res.status(403).json({error:'Cross-origin session action blocked.',code:'CSRF_ORIGIN_DENIED'});
 if(origin){
  let valid=false;
  try{
   const parsed=new URL(origin);
   valid=(parsed.host.toLowerCase()===host
     &&(parsed.protocol==='https:'||(parsed.protocol==='http:'&&
       /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))));
  }catch{}
  if(!valid)return res.status(403).json({error:'Cross-origin session action blocked.',code:'CSRF_ORIGIN_DENIED'});
 }else if(fetchSite!=='same-origin'){
  return res.status(403).json({error:'A trusted same-origin request is required.',code:'CSRF_ORIGIN_REQUIRED'});
 }
 next();
});

app.use(redirectLeakedCredentials);
app.use(express.json({ limit: '10mb', verify(req, _res, buffer) {
  if (['/api/cloud-sync/receive','/api/cloud-sync/receive-operations',
       '/api/cloud-sync/health-school'].includes(req.path)) req.rawBody = Buffer.from(buffer);
} }));

registerAuthRoutes(app, pool);
const { authenticateSchoolClient, requireSchoolRoles, requireSchoolPermission, requireTeacherDesignations, requireSchoolClient, authenticatePlatform, requirePlatformAdmin } = createAuthMiddleware(pool);
const { requireSchoolFeature } = require('./school-feature-guard');
registerHelpAiRoutes(app, authenticateSchoolClient);
// Feature checks are additive and preserve access for schools not yet assigned a plan.
// Only selected feature endpoints are gated; attendance history and essential records remain accessible.
// School-facing effective entitlements; the Super Admin endpoint is not accessible to school users.
app.get('/api/school/entitlements', authenticateSchoolClient, async(req,res)=>{
 try{
  const result=await pool.query(`SELECT p.code,p.features,p.limits,ss.overrides,ss.status,ss.ends_at
   FROM school_subscriptions ss JOIN platform_plans p ON p.plan_id=ss.plan_id
   WHERE ss.school_id=$1`,[req.auth.schoolId]);
  res.set('Cache-Control','no-store');
  if(!result.rowCount)return res.json({configured:false,legacyAccess:true,features:{}});
  const item=result.rows[0],expired=!!(item.ends_at&&new Date(item.ends_at).getTime()<=Date.now());
  const features={...item.features,...item.overrides};
  // Essential attendance data must remain available after expiration.
  if(expired||['EXPIRED','SUSPENDED'].includes(item.status))
   for(const key of ['planner','advanced_analytics','sms_notifications','custom_branding'])features[key]=false;
  return res.json({configured:true,plan:item.code,status:item.status,expired,features,limits:item.limits});
 }catch(error){console.error('School entitlements:',error.message);res.status(503).json({error:'Could not verify school feature access.'});}
});
app.use('/api/planner', authenticateSchoolClient, requireSchoolFeature(pool, 'planner'));
app.use('/api/sms/messages', authenticateSchoolClient, requireSchoolFeature(pool, 'sms_notifications'));
app.use('/api/class-qr/sessions', authenticateSchoolClient, requireSchoolFeature(pool, 'qr_attendance'));
const requireSchoolAdmin = requireSchoolRoles('SCHOOL_ADMIN');
const requireSchoolAdminOrTeacher = requireSchoolRoles('SCHOOL_ADMIN', 'TEACHER');
const requireSchoolAdminOrDepartmentHeadOrTeacher = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER');
const requireSchoolUser = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER');
const requireSchoolAdminOrDepartmentHead = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD');
const validText = value => typeof value === 'string' && value.trim().length > 0;
registerSmsRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerParentRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerGuardianRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStudentRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin });
require('./subject-management-routes').registerSubjectManagementRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStudentPortalAccountRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerAcademicRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerShsRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerSpecialProgramRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerDepartmentRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerSchedulingConfigRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerPlannerRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerCloudSyncRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin });
registerAccountRoutes(app, pool, { authenticateSchoolClient });
registerSchoolRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerPlatformRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin });
registerPlatformBootstrapRoutes(app, pool);
registerSchoolAdminRecoveryRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin });
registerFlexibleScheduleRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerClassQrRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStaffLunchRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStaffObRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStaffLeaveRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStaffLeaveInboxRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerPrincipalRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerPrincipalClassImpactRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
require('./principal-sdo-routes').registerPrincipalSdoRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
require('./principal-workspace-routes').registerPrincipalWorkspaceRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
registerDepartmentWorkspaceRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStaffGateDtrRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerGateDtrReviewRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerMissingScanRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
const { registerGateOfflineRoutes } = require('./gate-offline-routes');
registerGateOfflineRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
registerForm48ReviewRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerManualAttendanceRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerClassFinalizationRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerSardoRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerPhotoRoutes(app, pool, { authenticateSchoolClient });
registerPlatformPhotoRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin });
registerNotificationRoutes(app, pool, { authenticateSchoolClient, authenticatePlatform });
require('./school-memo-routes').registerSchoolMemoRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
const { registerStudentManagementRoutes } = require('./student-management-routes');
const { registerSf1ImportRoutes } = require('./sf1-import-routes');
registerStudentManagementRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerSf1ImportRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
const registerSf2Routes = require('./sf2-routes');
registerSf2Routes(app, pool, { authenticateSchoolClient, requireSchoolUser, requireSchoolAdmin, requireSchoolAdminOrDepartmentHead });


const isUuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

// Account administration remains School Admin-only; Department Heads may create TEACHER accounts only in their own department.
// All reads/writes are scoped to req.auth.schoolId; callers cannot submit a school_id.
app.get('/api/teachers', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  if (req.auth.role === 'DEPARTMENT_HEAD' && !req.auth.departmentId)
    return res.status(403).json({ error: 'A department assignment is required to view teacher records.' });
  const ownDepartment = req.auth.role === 'DEPARTMENT_HEAD';
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username,
              su.display_name AS "displayName", su.active,
              su.department_id AS "departmentId",
              COALESCE((SELECT d.department_name FROM school_departments d WHERE d.school_id=su.school_id AND d.department_id=su.department_id), 'Unassigned') AS "departmentName",
              su.teacher_designations AS "teacherDesignations", su.teacher_position AS "position",
              (su.teacher_photo_path IS NOT NULL) AS "hasTeacherPhoto",
              COALESCE((SELECT json_agg(json_build_object('gradeLevel', ca.grade_level, 'section', ca.section) ORDER BY ca.grade_level, ca.section)
                        FROM class_adviser_assignments ca
                        WHERE ca.school_id=su.school_id AND ca.adviser_user_id=su.user_id), '[]'::json) AS "adviserSections",
              CASE
                WHEN UPPER(COALESCE(su.teacher_status, '')) = 'ON_LEAVE'
                  OR (su.active = FALSE AND su.leave_type IS NOT NULL
                      AND su.expected_return_date IS NOT NULL)
                  THEN 'ON_LEAVE'
                WHEN su.active = TRUE THEN 'ACTIVE'
                ELSE COALESCE(NULLIF(UPPER(su.teacher_status), ''), 'INACTIVE')
              END AS "teacherStatus",
              su.leave_type AS "leaveType",
              su.leave_start_date AS "leaveStartDate",
              su.expected_return_date AS "expectedReturnDate",
              su.leave_auto_reactivate AS "leaveAutoReactivate",
              su.updated_at AS "appliedAt", su.last_login_at AS "lastLoginAt",
              COALESCE(
                json_agg(json_build_object(
                  'periodId', p.period_id,
                  'periodName', p.period_name,
                  'subjectName', p.subject_name,
                  'gradeLevel', p.grade_level,
                  'section', p.section,
                  'classroom', p.classroom,
                  'departmentId', p.department_id,
                  'startTime', to_char(p.start_time, 'HH24:MI'),
                  'endTime', to_char(p.end_time, 'HH24:MI')
                ) ORDER BY p.start_time)
                FILTER (WHERE p.period_id IS NOT NULL), '[]'::json
              ) AS "assignedPeriods"
       FROM school_users su
       LEFT JOIN teacher_period_assignments a
         ON a.school_id=su.school_id AND a.teacher_user_id=su.user_id
       LEFT JOIN class_periods p
         ON p.school_id=a.school_id AND p.period_id=a.period_id AND p.active=TRUE
       WHERE su.school_id=$1 AND su.role='TEACHER'
         AND ($2::uuid IS NULL OR su.department_id=$2::uuid)
       GROUP BY su.user_id
       ORDER BY su.active DESC, su.display_name, su.username`,
      [req.auth.schoolId,ownDepartment ? req.auth.departmentId : null]
    );
    const substitutionResult = await pool.query(
      `SELECT ts.substitution_id AS "substitutionId", ts.period_id AS "periodId",
              ts.original_teacher_user_id AS "originalTeacherUserId",
              ts.substitute_teacher_user_id AS "substituteTeacherUserId",
              original.display_name AS "originalTeacherName",
              substitute.display_name AS "substituteTeacherName",
              p.period_name AS "periodName", p.subject_name AS "subjectName",
              p.grade_level AS "gradeLevel", p.section,
              to_char(ts.start_date, 'YYYY-MM-DD') AS "startDate",
              to_char(ts.end_date, 'YYYY-MM-DD') AS "endDate"
       FROM teacher_period_substitutions ts
       JOIN school_users original
         ON original.school_id=ts.school_id AND original.user_id=ts.original_teacher_user_id
       JOIN school_users substitute
         ON substitute.school_id=ts.school_id AND substitute.user_id=ts.substitute_teacher_user_id
       JOIN class_periods p
         ON p.school_id=ts.school_id AND p.period_id=ts.period_id
       WHERE ts.school_id=$1 AND ts.status='ACTIVE'
         AND ($2::uuid IS NULL OR original.department_id=$2::uuid OR substitute.department_id=$2::uuid)
         AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
       ORDER BY ts.start_date, p.start_time`,
      [req.auth.schoolId,ownDepartment ? req.auth.departmentId : null]
    );
    const teacherById = new Map(result.rows.map(teacher => {
      teacher.substitutionAssignments = [];
      return [String(teacher.userId), teacher];
    }));
    for (const sub of substitutionResult.rows) {
      const shared = {
        substitutionId: sub.substitutionId,
        periodId: sub.periodId,
        periodName: sub.periodName,
        subjectName: sub.subjectName,
        gradeLevel: sub.gradeLevel,
        section: sub.section,
        startDate: sub.startDate,
        endDate: sub.endDate,
        originalTeacherUserId: sub.originalTeacherUserId,
        substituteTeacherUserId: sub.substituteTeacherUserId,
        originalTeacherName: sub.originalTeacherName,
        substituteTeacherName: sub.substituteTeacherName
      };
      const originalRow = teacherById.get(String(sub.originalTeacherUserId));
      const substituteRow = teacherById.get(String(sub.substituteTeacherUserId));
      if (originalRow) originalRow.substitutionAssignments.push({ ...shared, relationship: 'ORIGINAL' });
      if (substituteRow) substituteRow.substitutionAssignments.push({ ...shared, relationship: 'SUBSTITUTE' });
    }
    return res.json({ teachers: result.rows });
  } catch (err) {
    console.error('Teacher list failed:', err.message);
    return res.status(500).json({ error: 'Could not load teachers.' });
  }
});

// School account directory and creation. Parent accounts use the dedicated parent workflow.
app.get('/api/school-users', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName", su.role,
              su.teacher_designations AS "teacherDesignations", su.teacher_position AS "position", su.department_id AS "departmentId",
              COALESCE(d.department_name, 'Unassigned') AS "departmentName", su.active,
              su.updated_at AS "appliedAt", su.last_login_at AS "lastLoginAt"
       FROM school_users su
       LEFT JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id
       WHERE su.school_id=$1 AND su.role IN ('PRINCIPAL', 'DEPARTMENT_HEAD', 'GATE_KEEPER')
       ORDER BY CASE su.role WHEN 'PRINCIPAL' THEN 1 WHEN 'DEPARTMENT_HEAD' THEN 2 WHEN 'GATE_KEEPER' THEN 3 ELSE 4 END,
                su.display_name, su.username`,
      [req.auth.schoolId]
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('School account list failed:', err.message);
    return res.status(500).json({ error: 'Could not load school accounts.' });
  }
});

app.post('/api/school-users', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  const { username, displayName, password } = req.body || {};
  const role = String(req.body?.role || '').toUpperCase();
  const isDepartmentHead = req.auth.role === 'DEPARTMENT_HEAD';
  let departmentId = req.body?.departmentId || null;
  // Department Heads can onboard Subject Teachers for their assigned department.
  // They cannot create privileged roles or place accounts in other departments.
  if (isDepartmentHead) {
    if (role !== 'TEACHER') return res.status(403).json({ error: 'Department Heads can create teacher accounts only.' });
    if (!isUuid(req.auth.departmentId) || req.auth.departmentCode === 'UNASSIGNED') {
      return res.status(403).json({ error: 'Ask the School Administrator to assign your department before adding teachers.' });
    }
    if (departmentId && String(departmentId) !== String(req.auth.departmentId)) {
      return res.status(403).json({ error: 'You can create teachers only in your assigned department.' });
    }
    departmentId = req.auth.departmentId;
  }
  const position = role === 'TEACHER' && typeof req.body?.position === 'string' ? req.body.position.trim() : null;
  if (role === 'TEACHER' && req.body?.position != null && (typeof req.body.position !== 'string' || position.length > 100)) {
    return res.status(400).json({ error: 'Teacher position must be text up to 100 characters.' });
  }
  const allowedRoles = ['TEACHER', 'DEPARTMENT_HEAD', 'GATE_KEEPER', 'PRINCIPAL'];
  let designations = [];
  if (role === 'TEACHER') {
    const supplied = Array.isArray(req.body?.teacherDesignations) ? req.body.teacherDesignations : ['SUBJECT_TEACHER'];
    designations = [...new Set(supplied.map(value => String(value).toUpperCase()))];
    if (!designations.length || designations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
      return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
    }
  }
  if (!allowedRoles.includes(role) || !validText(username) || username.trim().length > 80 ||
      !validText(displayName) || displayName.trim().length > 160 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Provide a valid account role, username, display name, and password of at least 12 characters.' });
  }
  if(role==='PRINCIPAL'&&departmentId)
    return res.status(400).json({error:'The Principal has school-wide access and must not be assigned to one department.'});
   if (!departmentId && ['GATE_KEEPER','PRINCIPAL'].includes(role)) {
    const fallback = await pool.query(
      "SELECT department_id FROM school_departments WHERE school_id=$1 AND department_code='UNASSIGNED' AND active=TRUE",
      [req.auth.schoolId]
    );
    departmentId = fallback.rows[0]?.department_id || null;
    if (!departmentId) return res.status(409).json({ error:'The school must have an active Unassigned system department before creating leadership or Gatekeeper accounts.' });
  }
  if (['TEACHER', 'DEPARTMENT_HEAD'].includes(role) && !isUuid(departmentId)) {
    return res.status(400).json({ error: 'Choose the department for this teacher or Department Head account.' });
  }
  if (departmentId) {
    const department = await pool.query(
      'SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE',
      [req.auth.schoolId, departmentId]
    );
    if (!department.rowCount) return res.status(400).json({ error: 'Choose an active department in this school.' });
  }
  let passwordHash;
  try { passwordHash = await hashPassword(password); }
  catch (err) { return res.status(400).json({ error: err.message || 'Password does not meet requirements.' }); }

  try {
    const created = await pool.query(
      `INSERT INTO school_users (school_id, username, display_name, password_hash, role, teacher_designations, department_id, teacher_qr_token, teacher_position)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5='TEACHER' THEN gen_random_uuid() ELSE NULL END, $8)
       RETURNING user_id AS "userId", username, display_name AS "displayName", role,
                 teacher_designations AS "teacherDesignations", teacher_position AS "position", department_id AS "departmentId", active, updated_at AS "appliedAt"`,
      [req.auth.schoolId, username.trim(), displayName.trim(), passwordHash, role, designations, departmentId, position || null]
    );
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,$5,'school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, created.rows[0].userId,
       JSON.stringify({ username: username.trim(), role, teacherDesignations: designations, departmentId }),
       isDepartmentHead ? 'DEPARTMENT_HEAD_CREATE_TEACHER' : 'SCHOOL_ADMIN_CREATE_ACCOUNT']
    );
    return res.status(201).json({ user: created.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already used by an account in this school.' });
    console.error('School account creation failed:', err.message);
    return res.status(500).json({ error: 'Could not create school account.' });
  }
});

app.patch('/api/school-users/:userId/profile', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid school account ID.' });
  const { displayName, active } = req.body || {};
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 160 ||
      typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Provide a display name (up to 160 characters) and active status.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT user_id AS "userId", username, display_name AS "displayName", role, active
       FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role IN ('PRINCIPAL','DEPARTMENT_HEAD','GATE_KEEPER')
       FOR UPDATE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Leadership or staff account not found.' });
    }
    const updated = await client.query(
      `UPDATE school_users
       SET display_name=$3, active=$4, updated_at=NOW(),
           session_version=CASE WHEN $4 IS FALSE THEN session_version+1 ELSE session_version END
       WHERE school_id=$1 AND user_id=$2
       RETURNING user_id AS "userId", username, display_name AS "displayName", role, active`,
      [req.auth.schoolId, req.params.userId, displayName.trim(), active]
    );
    if (!active) {
      await client.query(
        `UPDATE user_sessions SET revoked_at=NOW()
         WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
        [req.auth.schoolId, req.params.userId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_STAFF_ACCOUNT','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ before: before.rows[0], after: updated.rows[0] })]
    );
    await client.query('COMMIT');
    return res.json({ user: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Staff account profile update failed:', err.message);
    return res.status(500).json({ error: 'Could not update staff account.' });
  } finally {
    client.release();
  }
});



registerEmployeeSecurityDirectoryRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin });

app.get('/api/admin/security/accounts', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName",
              su.role, su.active, su.updated_at AS "appliedAt", su.last_login_at AS "lastLoginAt",
              su.failed_login_attempts AS "failedLoginAttempts", su.locked_until AS "lockedUntil",
              su.must_change_password AS "mustChangePassword",
              su.teacher_designations AS "teacherDesignations",
              d.department_name AS "departmentName",
              COALESCE((SELECT COUNT(*)::int FROM user_sessions us
                        WHERE us.principal_type='SCHOOL' AND us.school_id=su.school_id
                          AND us.school_user_id=su.user_id AND us.revoked_at IS NULL
                          AND us.expires_at>NOW()),0) AS "activeSessions"
       FROM school_users su
       LEFT JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id
       WHERE su.school_id=$1 AND su.role IN ('TEACHER','PRINCIPAL','DEPARTMENT_HEAD','GATE_KEEPER')
       ORDER BY su.active DESC, su.role, su.display_name, su.username`,
      [req.auth.schoolId]
    );
    return res.json({ accounts: result.rows });
  } catch (err) {
    console.error('Security account list failed:', err.message);
    return res.status(500).json({ error: 'Could not load account security status.' });
  }
});

app.post('/api/admin/security/accounts/:userId/reset-password', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid account ID.' });
  const temporaryPassword = 'Tmp-' + crypto.randomBytes(18).toString('base64url') + '-9a';
  let passwordHash;
  try { passwordHash = await hashPassword(temporaryPassword); }
  catch (err) { return res.status(500).json({ error: 'Could not prepare a secure temporary password.' }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT user_id, username, display_name, role, active
       FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','PRINCIPAL','DEPARTMENT_HEAD','GATE_KEEPER')
       FOR UPDATE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Staff account not found.' });
    }
    await client.query(
      `UPDATE school_users
       SET password_hash=$3, must_change_password=TRUE,
           failed_login_attempts=0, locked_until=NULL,
           session_version=session_version+1, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2`,
      [req.auth.schoolId, req.params.userId, passwordHash]
    );
    const revoked = await client.query(
      `UPDATE user_sessions SET revoked_at=NOW()
       WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
      [req.auth.schoolId, req.params.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_RESET_STAFF_PASSWORD','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ username: target.rows[0].username, revokedSessions: revoked.rowCount, mustChangePassword: true })]
    );
    await client.query('COMMIT');
    return res.json({
      account: { userId: target.rows[0].user_id, username: target.rows[0].username, displayName: target.rows[0].display_name },
      temporaryPassword,
      revokedSessions: revoked.rowCount,
      mustChangePassword: true
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Staff password reset failed:', err.message);
    return res.status(500).json({ error: 'Could not reset this staff account password.' });
  } finally { client.release(); }
});

app.post('/api/admin/security/accounts/:userId/revoke-sessions', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid account ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT user_id, username FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','PRINCIPAL','DEPARTMENT_HEAD','GATE_KEEPER')
       FOR UPDATE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Staff account not found.' });
    }
    const revoked = await client.query(
      `UPDATE user_sessions SET revoked_at=NOW()
       WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2
         AND revoked_at IS NULL AND expires_at>NOW()`,
      [req.auth.schoolId, req.params.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_REVOKE_STAFF_SESSIONS','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ username: target.rows[0].username, revokedSessions: revoked.rowCount })]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, revokedSessions: revoked.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Staff session revocation failed:', err.message);
    return res.status(500).json({ error: 'Could not revoke this account’s sessions.' });
  } finally { client.release(); }
});

app.post('/api/admin/security/accounts/:userId/unlock', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid account ID.' });
  try {
    const updated = await pool.query(
      `UPDATE school_users SET failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','PRINCIPAL','DEPARTMENT_HEAD','GATE_KEEPER')
       RETURNING user_id, username`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!updated.rowCount) return res.status(404).json({ error: 'Staff account not found.' });
    await pool.query(
      `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UNLOCK_STAFF_ACCOUNT','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ username: updated.rows[0].username })]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Staff account unlock failed:', err.message);
    return res.status(500).json({ error: 'Could not unlock this staff account.' });
  }
});

app.get('/api/admin/security/audit', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
              a.details, a.created_at AS "createdAt",
              COALESCE(actor.display_name, actor.username, 'System') AS "actorName"
       FROM audit_logs a
       LEFT JOIN school_users actor
         ON actor.school_id=a.school_id AND actor.user_id=a.actor_user_id
       WHERE a.school_id=$1
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [req.auth.schoolId]
    );
    return res.json({ events: result.rows });
  } catch (err) {
    console.error('Security audit history failed:', err.message);
    return res.status(500).json({ error: 'Could not load account audit history.' });
  }
});

// Gate Keeper monitoring is available to the School Administrator only.
// This summary counts actual gate events recorded by each Gate Keeper, not login activity.
app.get('/api/admin/gatekeeper-monitoring', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName", su.active,
              COALESCE((SELECT COUNT(*)::int FROM attendance_events e
                        WHERE e.school_id=su.school_id AND e.recorded_by_user_id=su.user_id
                          AND e.attendance_scope='SCHOOL' AND e.sync_status='ACCEPTED'
                          AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date),0) AS "studentScansToday",
              (COALESCE((SELECT COUNT(*)::int FROM teacher_gate_events tge
                        WHERE tge.school_id=su.school_id AND tge.recorded_by_user_id=su.user_id
                          AND tge.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date),0)
                + COALESCE((SELECT COUNT(*)::int FROM staff_attendance_events sae
                        WHERE sae.school_id=su.school_id AND sae.actor_user_id=su.user_id
                          AND sae.event_kind='GATE_MOVEMENT' AND sae.verification_status='VERIFIED'
                          AND sae.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date),0)) AS "teacherPunchesToday",
              GREATEST(
                (SELECT MAX(e.received_at_server) FROM attendance_events e
                 WHERE e.school_id=su.school_id AND e.recorded_by_user_id=su.user_id AND e.attendance_scope='SCHOOL'),
                (SELECT MAX(tge.created_at) FROM teacher_gate_events tge
                 WHERE tge.school_id=su.school_id AND tge.recorded_by_user_id=su.user_id),
                (SELECT MAX(sae.created_at) FROM staff_attendance_events sae
                 WHERE sae.school_id=su.school_id AND sae.actor_user_id=su.user_id
                   AND sae.event_kind='GATE_MOVEMENT' AND sae.verification_status='VERIFIED')
              ) AS "lastActivityAt"
       FROM school_users su
       WHERE su.school_id=$1 AND su.role='GATE_KEEPER'
       ORDER BY su.active DESC, su.display_name, su.username`,
      [req.auth.schoolId]
    );
    return res.json({ gateKeepers: result.rows, schoolDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) });
  } catch (err) {
    console.error('Gate Keeper monitoring failed:', err.message);
    return res.status(500).json({ error: 'Could not load Gate Keeper monitoring.' });
  }
});

// Teachers can only read their OWN verified gatekeeper-recorded time events.
// Never accept teacher IDs from query parameters or allow writes through this endpoint.
app.get('/api/teacher/my-gate-attendance', authenticateSchoolClient, requireSchoolRoles('TEACHER', 'DEPARTMENT_HEAD', 'SCHOOL_ADMIN', 'PRINCIPAL'), async (req, res) => {
  const schoolDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const from = typeof req.query.from === 'string' ? req.query.from : schoolDate;
  const to = typeof req.query.to === 'string' ? req.query.to : schoolDate;
  if (!isValidSchoolDate(from) || !isValidSchoolDate(to) || from > to ||
      (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) > 31 * 86400000) {
    return res.status(400).json({ error: 'Choose a valid date range of up to 31 days.' });
  }
  try {
    const result = await pool.query(
      `SELECT "eventId","eventType","schoolDate","occurredAt","photoVerified" FROM (
        SELECT event_id AS "eventId",
          CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
          to_char(school_date,'YYYY-MM-DD') AS "schoolDate",occurred_at AS "occurredAt",
          TRUE AS "photoVerified"
        FROM staff_attendance_events
        WHERE school_id=$1 AND staff_user_id=$2
          AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
          AND school_date BETWEEN $3::date AND $4::date
        UNION ALL
        SELECT event_id AS "eventId",event_type AS "eventType",
          to_char(school_date,'YYYY-MM-DD') AS "schoolDate",occurred_at AS "occurredAt",
          photo_verified AS "photoVerified"
        FROM teacher_gate_events
        WHERE school_id=$1 AND teacher_user_id=$2
          AND school_date BETWEEN $3::date AND $4::date
       ) gate_history ORDER BY "schoolDate" DESC,"occurredAt" ASC`,
      [req.auth.schoolId, req.auth.userId, from, to]
    );
    return res.json({ events: result.rows, from, to });
  } catch (err) {
    console.error('Teacher personal gate attendance failed:', err.message);
    return res.status(500).json({ error: 'Could not load your gate attendance records.' });
  }
});

// Own staff QR badge: authenticated staff (including Department Heads), never records attendance.
app.post('/api/staff-attendance/my/badge', authenticateSchoolClient, requireSchoolRoles('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'), async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  try {
    const result = await pool.query(
      `UPDATE school_users SET teacher_qr_token=COALESCE(teacher_qr_token,gen_random_uuid())
       WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL') AND active=TRUE
         AND (EXISTS (SELECT 1 FROM official_profile_photos p
           WHERE p.school_id=school_users.school_id AND p.subject_kind='STAFF'
             AND p.subject_id=school_users.user_id::text)
           OR (role='TEACHER' AND teacher_photo_path IS NOT NULL))
       RETURNING display_name AS "displayName", teacher_qr_token AS "qrToken"`,
      [req.auth.schoolId, req.auth.userId]);
    if (!result.rowCount) return res.status(409).json({error:'An approved or registered staff photo is required before showing your gate badge.'});
    const owner = result.rows[0];
    const qrCode = await QRCode.toDataURL('TCH:' + owner.qrToken,
      {width:360,margin:2,errorCorrectionLevel:'H'});
    return res.json({displayName:owner.displayName,qrCode});
  } catch (error) {
    console.error('Staff own gate badge:', error.message);
    return res.status(503).json({error:'Could not prepare your staff QR badge.'});
  }
});

// Read-only teacher gate attendance history for the School Administrator and Department Head.
app.get('/api/admin/teacher-gate-attendance', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  const requestedDate = typeof req.query.date === 'string' ? req.query.date : '';
  const schoolDate = requestedDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (!isValidSchoolDate(schoolDate)) return res.status(400).json({ error: 'Provide a valid school date (YYYY-MM-DD).' });
  try {
    const result = await pool.query(
      `SELECT g."eventId",g."teacherUserId",teacher.display_name AS "teacherName",teacher.username,
        g."eventType",g."schoolDate",g."occurredAt",g."photoVerified",
        gatekeeper.display_name AS "recordedBy"
       FROM (
        SELECT event_id AS "eventId",staff_user_id AS "teacherUserId",
          CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
          school_date AS "schoolDate",occurred_at AS "occurredAt",TRUE AS "photoVerified",
          actor_user_id AS "recordedById"
        FROM staff_attendance_events WHERE school_id=$1 AND school_date=$2::date
          AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
        UNION ALL
        SELECT event_id AS "eventId",teacher_user_id AS "teacherUserId",
          event_type AS "eventType",school_date AS "schoolDate",
          occurred_at AS "occurredAt",photo_verified AS "photoVerified",
          recorded_by_user_id AS "recordedById"
        FROM teacher_gate_events WHERE school_id=$1 AND school_date=$2::date
       ) g
       JOIN school_users teacher ON teacher.school_id=$1 AND teacher.user_id=g."teacherUserId"
       JOIN school_users gatekeeper ON gatekeeper.school_id=$1 AND gatekeeper.user_id=g."recordedById"
       WHERE ($3::text='SCHOOL_ADMIN' OR teacher.department_id=$4::uuid)
       ORDER BY g."occurredAt" DESC,teacher.display_name`,
      [req.auth.schoolId, schoolDate, req.auth.role, req.auth.departmentId || null]
    );
    return res.json({ events: result.rows, schoolDate });
  } catch (err) {
    console.error('Teacher gate attendance list failed:', err.message);
    return res.status(500).json({ error: 'Could not load teacher gate attendance.' });
  }
});

app.get('/api/class-adviser-assignments', authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'), async (req, res) => {
    try {
      const params = [req.auth.schoolId];
      let teacherFilter = '';
      if (req.auth.role === 'TEACHER') {
        params.push(req.auth.userId);
        teacherFilter = ' AND ca.adviser_user_id=$2';
      } else if (req.auth.role === 'DEPARTMENT_HEAD') {
        params.push(req.auth.departmentId);
        // A section can be advisory-only (for example, SPJ) and have no subject period.
        // Department Heads see adviser assignments owned by teachers in their department.
        teacherFilter = ` AND EXISTS (
          SELECT 1 FROM school_users adviser
          WHERE adviser.school_id=ca.school_id
            AND adviser.user_id=ca.adviser_user_id
            AND adviser.role='TEACHER'
            AND adviser.department_id=$2
        )`;
      }
      const result = await pool.query(
        `SELECT ca.assignment_id AS "assignmentId", ca.adviser_user_id AS "adviserUserId",
                su.display_name AS "adviserName", ca.grade_level AS "gradeLevel", ca.section,
                ca.assigned_at AS "assignedAt"
         FROM class_adviser_assignments ca
         JOIN school_users su ON su.school_id=ca.school_id AND su.user_id=ca.adviser_user_id
         WHERE ca.school_id=$1${teacherFilter}
         ORDER BY ca.grade_level, ca.section`, params
      );
      return res.json({ assignments: result.rows });
    } catch (err) {
      console.error('Class adviser assignments load failed:', err.message);
      return res.status(500).json({ error: 'Could not load class adviser assignments.' });
    }
  });

// Official Class Adviser for a school section. This read-only lookup is not limited to the caller's department.
app.get('/api/scheduling/section-adviser', authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req,res) => {
    const grade=String(req.query.gradeLevel||'').trim(),section=String(req.query.section||'').trim();
    if(!grade||!section||grade.length>40||section.length>100)
      return res.status(400).json({error:'Select a valid grade and section.'});
    try{
      const result=await pool.query(
        'SELECT ca.assignment_id AS "assignmentId",ca.adviser_user_id AS "adviserUserId",' +
        ' su.display_name AS "adviserName",su.active AS "adviserActive" ' +
        'FROM class_adviser_assignments ca JOIN school_users su ' +
        'ON su.school_id=ca.school_id AND su.user_id=ca.adviser_user_id ' +
        'WHERE ca.school_id=$1 AND LOWER(BTRIM(ca.grade_level))=LOWER(BTRIM($2)) ' +
        'AND UPPER(BTRIM(ca.section))=UPPER(BTRIM($3)) LIMIT 1',
        [req.auth.schoolId,grade,section]);
      return res.json({assignment:result.rows[0]||null});
    }catch(error){
      console.error('Section adviser lookup failed:',error.message);
      return res.status(500).json({error:'Could not retrieve the official Class Adviser.'});
    }
  });

// School-scoped grade/section choices for adviser assignments.
// This is independent of the dashboard learner roster, which may be unavailable to a Department Head.
// Eligibility matches the existing Class Adviser assignment check: active learners in the school,
// using current active-year enrollment when available and retained student records otherwise.
// Grade/section options for adviser assignments include official registered sections
// even if they have zero enrolled learners. This endpoint is read-only and school-scoped.
app.get('/api/class-adviser-eligible-sections', authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD'), async (req,res) => {
    try {
      const sql=[
        'SELECT x.grade_level AS "gradeLevel",x.section,',
        'SUM(x.learner_count)::int AS "learnerCount",',
        'SUM(x.enrolled_count)::int AS "enrolledCount",',
        'BOOL_OR(x.registered) AS "registered"',
        'FROM (',
        'SELECT COALESCE(NULLIF(BTRIM(en.grade_level),\'\'),NULLIF(BTRIM(s.grade_level),\'\')) AS grade_level,',
        'COALESCE(NULLIF(BTRIM(en.section),\'\'),NULLIF(BTRIM(s.section),\'\')) AS section,',
        '1::int AS learner_count,',
        'CASE WHEN en.grade_level IS NOT NULL THEN 1 ELSE 0 END AS enrolled_count,',
        'FALSE AS registered',
        'FROM students s LEFT JOIN LATERAL (',
        'SELECT e.grade_level,e.section FROM student_enrollments e',
        'JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id',
        'WHERE e.school_id=s.school_id AND e.student_id=s.student_id',
        'AND sy.status=\'ACTIVE\' AND e.enrollment_status=\'ENROLLED\'',
        'ORDER BY e.created_at DESC LIMIT 1',
        ') en ON TRUE',
        'WHERE s.school_id=$1 AND s.active=TRUE AND s.archived_at IS NULL',
        'UNION ALL',
        'SELECT BTRIM(ss.grade_level),BTRIM(ss.section_name),0::int,0::int,TRUE',
        'FROM school_sections ss WHERE ss.school_id=$1 AND ss.active=TRUE',
        ') x',
        'WHERE x.grade_level IS NOT NULL AND x.grade_level<>\'\'',
        'AND x.section IS NOT NULL AND x.section<>\'\'',
        'GROUP BY x.grade_level,x.section ORDER BY x.grade_level,x.section'
      ].join(' ');
      const result=await pool.query(sql,[req.auth.schoolId]);
      return res.json({sections:result.rows});
    } catch (error) {
      console.error('Adviser eligible sections lookup failed:',error.message);
      return res.status(500).json({error:'Could not load eligible registered or active learner sections.'});
    }
  });

app.post('/api/class-adviser-assignments', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  const { adviserUserId, gradeLevel, section } = req.body || {};
  if (!isUuid(adviserUserId) || !validText(gradeLevel) || gradeLevel.trim().length > 40 ||
      !validText(section) || section.trim().length > 100) {
    return res.status(400).json({ error: 'Select an active Class Adviser and provide a valid grade and section.' });
  }
  try {
    const adviser = await pool.query(
      "SELECT department_id FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE AND 'CLASS_ADVISER'=ANY(teacher_designations)",
      [req.auth.schoolId, adviserUserId]
    );
    if (!adviser.rowCount) return res.status(400).json({ error: 'Choose an active teacher with the Class Adviser designation.' });
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      if (String(adviser.rows[0].department_id) !== String(req.auth.departmentId)) return res.status(403).json({ error: 'You can assign only teachers in your own department.' });
      // Advisory sections need not have a regular subject-period schedule.
      // Permit a section when it has active students in the current school-year enrollment.
      const eligibleSectionResult = await pool.query(
        `SELECT 1
         FROM students s
         LEFT JOIN LATERAL (
           SELECT en.grade_level,en.section
           FROM student_enrollments en
           JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
           WHERE en.school_id=s.school_id AND en.student_id=s.student_id
             AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
           ORDER BY en.created_at DESC LIMIT 1
         ) active_enrollment ON TRUE
         WHERE s.school_id=$1 AND s.active=TRUE AND s.archived_at IS NULL
           AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2
           AND UPPER(BTRIM(COALESCE(active_enrollment.section,s.section)))=UPPER(BTRIM($3))
         UNION
         SELECT 1 FROM school_sections ss
         WHERE ss.school_id=$1 AND ss.active=TRUE
           AND LOWER(BTRIM(ss.grade_level))=LOWER(BTRIM($2))
           AND UPPER(BTRIM(ss.section_name))=UPPER(BTRIM($3))
         LIMIT 1`,
        [req.auth.schoolId, gradeLevel.trim(), section.trim()]
      );
      if (!eligibleSectionResult.rowCount) return res.status(403).json({ error: 'Choose a registered school section or a section with active learner records. Ask School Admin to register a missing section.' });
    }
    const existingAdviser = await pool.query(
      'SELECT ca.assignment_id AS "assignmentId",ca.adviser_user_id AS "adviserUserId",su.display_name AS "adviserName" '+
      'FROM class_adviser_assignments ca JOIN school_users su ON su.school_id=ca.school_id AND su.user_id=ca.adviser_user_id '+
      'WHERE ca.school_id=$1 AND LOWER(BTRIM(ca.grade_level))=LOWER(BTRIM($2)) '+
      'AND UPPER(BTRIM(ca.section))=UPPER(BTRIM($3)) LIMIT 1',
      [req.auth.schoolId,gradeLevel.trim(),section.trim()]
    );
    if (existingAdviser.rowCount) {
      const current=existingAdviser.rows[0];
      return res.status(409).json({
        error: String(current.adviserUserId)===String(adviserUserId)
          ? 'This section is already assigned to the selected Class Adviser.'
          : 'This section already has a Class Adviser. Review the existing assignment before making any changes.'
      });
    }
    const result = await pool.query(
      `INSERT INTO class_adviser_assignments(school_id, adviser_user_id, grade_level, section, assigned_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(school_id,grade_level,section) DO NOTHING
       RETURNING assignment_id AS "assignmentId", adviser_user_id AS "adviserUserId",
                 grade_level AS "gradeLevel", section`,
      [req.auth.schoolId, adviserUserId, gradeLevel.trim(), section.trim(), req.auth.userId]
    );
    if (!result.rowCount) {
      return res.status(409).json({ error: 'This section was assigned a Class Adviser by another action. Reload the assignments before saving.' });
    }
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_ASSIGN_CLASS_ADVISER','class_adviser_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, result.rows[0].assignmentId,
       JSON.stringify({ adviserUserId, gradeLevel: gradeLevel.trim(), section: section.trim() })]
    );
    return res.status(201).json({ assignment: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This section already has a Class Adviser assignment. Reload and review it before saving.' });
    if (err.code === '23514') return res.status(400).json({ error: err.message });
    console.error('Class adviser assignment failed:', err.message);
    return res.status(500).json({ error: 'Could not assign the Class Adviser. Please try again or contact the School Admin.' });
  }
});

app.patch('/api/class-adviser-assignments/:assignmentId', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  const { adviserUserId, gradeLevel, section } = req.body || {};
  if (!isUuid(req.params.assignmentId) || !isUuid(adviserUserId) ||
      !validText(gradeLevel) || gradeLevel.trim().length > 40 ||
      !validText(section) || section.trim().length > 100) {
    return res.status(400).json({ error: 'Choose an active Class Adviser and provide a valid grade and section.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16017)', [req.auth.schoolId]);
    const existing = await client.query(
      `SELECT assignment_id AS "assignmentId", adviser_user_id AS "adviserUserId",
              grade_level AS "gradeLevel", section
       FROM class_adviser_assignments
       WHERE school_id=$1 AND assignment_id=$2
       FOR UPDATE`,
      [req.auth.schoolId, req.params.assignmentId]
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class Adviser assignment not found.' });
    }
    const adviser = await client.query(
      `SELECT user_id FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND 'CLASS_ADVISER'=ANY(teacher_designations)`,
      [req.auth.schoolId, adviserUserId]
    );
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      const existingScope = await client.query(
        `SELECT 1
         FROM class_adviser_assignments ca
         JOIN school_users current_adviser
           ON current_adviser.school_id=ca.school_id
          AND current_adviser.user_id=ca.adviser_user_id
         WHERE ca.school_id=$1 AND ca.assignment_id=$2
           AND current_adviser.role='TEACHER'
           AND current_adviser.department_id=$3`,
        [req.auth.schoolId, req.params.assignmentId, req.auth.departmentId]
      );
      const targetScope = await client.query(
        `SELECT 1
         FROM students s
         LEFT JOIN LATERAL (
           SELECT en.grade_level,en.section
           FROM student_enrollments en
           JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
           WHERE en.school_id=s.school_id AND en.student_id=s.student_id
             AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
           ORDER BY en.created_at DESC LIMIT 1
         ) active_enrollment ON TRUE
         WHERE s.school_id=$1 AND s.active=TRUE AND s.archived_at IS NULL
           AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2
           AND UPPER(BTRIM(COALESCE(active_enrollment.section,s.section)))=UPPER(BTRIM($3))
         UNION
         SELECT 1 FROM school_sections ss
         WHERE ss.school_id=$1 AND ss.active=TRUE
           AND LOWER(BTRIM(ss.grade_level))=LOWER(BTRIM($2))
           AND UPPER(BTRIM(ss.section_name))=UPPER(BTRIM($3))
         LIMIT 1`,
        [req.auth.schoolId, gradeLevel.trim(), section.trim()]
      );
      const adviserScope = await client.query(
        "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND department_id=$3 AND role='TEACHER' AND active=TRUE AND 'CLASS_ADVISER'=ANY(teacher_designations)",
        [req.auth.schoolId, adviserUserId, req.auth.departmentId]
      );
      if (!existingScope.rowCount || !targetScope.rowCount || !adviserScope.rowCount) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You can edit Class Adviser assignments only for registered or active learner sections and teachers in your own department.' });
      }
    }
    if (!adviser.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The selected account must be an active teacher with the Class Adviser designation.' });
    }
    const duplicate = await client.query(
      `SELECT 1 FROM class_adviser_assignments
       WHERE school_id=$1 AND assignment_id<>$2
         AND lower(btrim(grade_level))=lower(btrim($3))
         AND upper(btrim(section))=upper(btrim($4))
       LIMIT 1`,
      [req.auth.schoolId, req.params.assignmentId, gradeLevel.trim(), section.trim()]
    );
    if (duplicate.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Another Class Adviser assignment already exists for this grade and section.' });
    }
    const updated = await client.query(
      `UPDATE class_adviser_assignments
       SET adviser_user_id=$3, grade_level=$4, section=$5, assigned_by=$6, assigned_at=NOW()
       WHERE school_id=$1 AND assignment_id=$2
       RETURNING assignment_id AS "assignmentId", adviser_user_id AS "adviserUserId",
                 grade_level AS "gradeLevel", section`,
      [req.auth.schoolId, req.params.assignmentId, adviserUserId, gradeLevel.trim(), section.trim(), req.auth.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_CLASS_ADVISER','class_adviser_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.assignmentId,
       JSON.stringify({ before: existing.rows[0], after: updated.rows[0] })]
    );
    await client.query('COMMIT');
    return res.json({ assignment: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' || err.code === '23514') {
      return res.status(409).json({ error: err.message || 'This class adviser assignment conflicts with another record.' });
    }
    console.error('Class Adviser assignment update failed:', err.message);
    return res.status(500).json({ error: 'Could not update the Class Adviser assignment.' });
  } finally {
    client.release();
  }
});

app.delete('/api/class-adviser-assignments/:assignmentId', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.assignmentId)) return res.status(400).json({ error: 'Invalid class adviser assignment ID.' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Confirm your password to remove this Class Adviser assignment.' });
  const actor = await pool.query('SELECT password_hash FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE', [req.auth.schoolId, req.auth.userId]);
  if (!actor.rowCount || !await verifyPassword(password, actor.rows[0].password_hash)) return res.status(401).json({ error: 'Password confirmation failed. No changes were made.' });
  try {
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      const scope = await pool.query(
        `SELECT 1 FROM class_adviser_assignments ca
         JOIN school_users adviser
           ON adviser.school_id=ca.school_id AND adviser.user_id=ca.adviser_user_id
         WHERE ca.school_id=$1 AND ca.assignment_id=$2
           AND adviser.role='TEACHER' AND adviser.department_id=$3`,
        [req.auth.schoolId, req.params.assignmentId, req.auth.departmentId]
      );
      if (!scope.rowCount) return res.status(403).json({ error: 'You can remove only Class Adviser assignments in your own department.' });
    }
    const result = await pool.query(
      `DELETE FROM class_adviser_assignments
       WHERE school_id=$1 AND assignment_id=$2
       RETURNING grade_level, section, adviser_user_id`, [req.auth.schoolId, req.params.assignmentId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Class adviser assignment not found.' });
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,$5,'class_adviser_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.assignmentId, JSON.stringify(result.rows[0]), 'DEPARTMENT_HEAD_UNASSIGN_CLASS_ADVISER']
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Class adviser unassignment failed:', err.message);
    return res.status(500).json({ error: 'Could not remove the Class Adviser assignment.' });
  }
});

app.patch('/api/teachers/:userId/designations', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const incoming = req.body?.teacherDesignations;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Provide teacherDesignations as an array.' });
  const designations = [...new Set(incoming.map(value => String(value).toUpperCase()))];
  if (!designations.length || designations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
    return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      const target = await client.query(
        "SELECT department_id FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE FOR UPDATE",
        [req.auth.schoolId, req.params.userId]
      );
      if (!target.rowCount || String(target.rows[0].department_id) !== String(req.auth.departmentId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You can manage teacher designations only within your own department.' });
      }
    }
    if (!designations.includes('CLASS_ADVISER')) {
      const assigned = await client.query(
        'SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 LIMIT 1',
        [req.auth.schoolId, req.params.userId]
      );
      if (assigned.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Remove this teacher\'s Class Adviser section assignments before removing the designation.' });
      }
    }
    const updated = await client.query(
      `UPDATE school_users SET teacher_designations=$3, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", teacher_designations AS "teacherDesignations"`,
      [req.auth.schoolId, req.params.userId, designations]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    const auditAction = req.auth.role === 'DEPARTMENT_HEAD'
      ? 'DEPARTMENT_HEAD_UPDATE_TEACHER_DESIGNATIONS'
      : 'SCHOOL_ADMIN_UPDATE_TEACHER_DESIGNATIONS';
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,$5,'school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ teacherDesignations: designations }), auditAction]
    );
    await client.query('COMMIT');
    return res.json({ teacher: updated.rows[0] });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { console.error('Teacher designation rollback failed:', rollbackError.message); }
    }
    if (err.code === '23514') return res.status(409).json({ error: err.message });
    console.error('Teacher designation update failed:', err.message);
    return res.status(500).json({ error: 'Teacher designation could not be saved. No changes were committed; please try again.' });
  } finally {
    client?.release();
  }
});

app.post('/api/teachers', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { username, displayName, password } = req.body || {};
  const departmentId = req.body?.departmentId || null;
  const position = typeof req.body?.position === 'string' ? req.body.position.trim() : null;
  if (req.body?.position != null && (typeof req.body.position !== 'string' || position.length > 100)) {
    return res.status(400).json({ error: 'Teacher position must be text up to 100 characters.' });
  }
  const teacherDesignations = Array.isArray(req.body?.teacherDesignations) ? [...new Set(req.body.teacherDesignations.map(value => String(value).toUpperCase()))] : ['SUBJECT_TEACHER'];
  if (!teacherDesignations.length || teacherDesignations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
    return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
  }
  if (!validText(username) || username.trim().length > 80 ||
      !validText(displayName) || displayName.trim().length > 160 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Provide a username (1â€“80 characters), display name (1â€“160 characters), and password (12â€“256 characters).' });
  }
  let assignedDepartmentId = departmentId;
  if (assignedDepartmentId) {
    const dept = await pool.query('SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE', [req.auth.schoolId, assignedDepartmentId]);
    if (!dept.rowCount) return res.status(400).json({ error: 'Choose an active department in this school.' });
  } else {
    const dept = await pool.query("SELECT department_id FROM school_departments WHERE school_id=$1 AND department_code='UNASSIGNED' AND active=TRUE", [req.auth.schoolId]);
    assignedDepartmentId = dept.rows[0]?.department_id || null;
  }
  if (!assignedDepartmentId) return res.status(400).json({ error: 'Create departments using the School Administrator account before creating teachers.' });
  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Password does not meet requirements.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO school_users (school_id, username, display_name, password_hash, role, teacher_designations, department_id, teacher_qr_token, teacher_position)
       VALUES ($1,$2,$3,$4,'TEACHER',$5,$6,gen_random_uuid(),$7)
       RETURNING user_id AS "userId", username, display_name AS "displayName", teacher_designations AS "teacherDesignations", teacher_position AS "position", department_id AS "departmentId", active, updated_at AS "appliedAt"`,
      [req.auth.schoolId, username.trim(), displayName.trim(), passwordHash, teacherDesignations, assignedDepartmentId, position || null]
    );
    const teacher = created.rows[0];
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CREATE_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, teacher.userId,
       JSON.stringify({ username: teacher.username, role: 'TEACHER' })]
    );
    await client.query('COMMIT');
    return res.status(201).json({ teacher });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already used by an account in this school.' });
    console.error('Teacher creation failed:', err.message);
    return res.status(500).json({ error: 'Could not create teacher account.' });
  } finally {
    client.release();
  }
});

app.patch('/api/teachers/:userId', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const { active, displayName, position } = req.body || {};
  const hasPosition = Object.prototype.hasOwnProperty.call(req.body || {}, 'position');
  if (hasPosition && (typeof position !== 'string' || position.trim().length > 100)) {
    return res.status(400).json({ error: 'Teacher position must be text up to 100 characters.' });
  }
  if (typeof active !== 'boolean' && !(typeof displayName === 'string' && displayName.trim().length > 0 && displayName.trim().length <= 160) && !hasPosition) {
    return res.status(400).json({ error: 'Provide a valid active value or display name.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE school_users
       SET active=COALESCE($3,active),
           teacher_status=CASE
             WHEN $3 IS FALSE THEN 'INACTIVE'
             WHEN $3 IS TRUE THEN 'ACTIVE'
             ELSE teacher_status
           END,
           leave_type=CASE WHEN $3 IS NOT NULL THEN NULL ELSE leave_type END,
           leave_start_date=CASE WHEN $3 IS NOT NULL THEN NULL ELSE leave_start_date END,
           expected_return_date=CASE WHEN $3 IS NOT NULL THEN NULL ELSE expected_return_date END,
           leave_auto_reactivate=CASE WHEN $3 IS NOT NULL THEN TRUE ELSE leave_auto_reactivate END,
           display_name=COALESCE($4,display_name),
           teacher_position=CASE WHEN $5 THEN NULLIF($6,'') ELSE teacher_position END,
           updated_at=NOW(),
           session_version=CASE WHEN $3 IS FALSE THEN session_version+1 ELSE session_version END
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus", teacher_position AS "position"`,
      [req.auth.schoolId, req.params.userId,
       typeof active === 'boolean' ? active : null,
       typeof displayName === 'string' ? displayName.trim() : null,
       hasPosition, hasPosition ? position.trim() : null]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    if (active === false) {
      await client.query(
        `UPDATE user_sessions SET revoked_at=NOW()
         WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
        [req.auth.schoolId, req.params.userId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ active: typeof active === 'boolean' ? active : undefined,
                        displayName: typeof displayName === 'string' ? displayName.trim() : undefined,
                        position: hasPosition ? position.trim() : undefined })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher update failed:', err.message);
    return res.status(500).json({ error: 'Could not update teacher account.' });
  } finally {
    client.release();
  }
});


// Put a teacher on temporary leave without deleting their account or schedule assignments.
app.post('/api/teachers/:userId/leave', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const { leaveType, startDate, expectedReturnDate, autoReactivate = true } = req.body || {};
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const allowedTypes = ['MATERNITY', 'SICK', 'VACATION', 'PERSONAL', 'OTHER'];
  if (!allowedTypes.includes(leaveType) || !validDate(startDate) ||
      !validDate(expectedReturnDate) || expectedReturnDate < startDate ||
      typeof autoReactivate !== 'boolean') {
    return res.status(400).json({ error: 'Provide a valid leave type, start date, expected return date, and automatic return preference.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE school_users
       SET active=FALSE, teacher_status='ON_LEAVE', leave_type=$3,
           leave_start_date=$4::date, expected_return_date=$5::date,
           leave_auto_reactivate=$6, session_version=session_version+1, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus", leave_type AS "leaveType",
                 leave_start_date AS "leaveStartDate", expected_return_date AS "expectedReturnDate",
                 leave_auto_reactivate AS "leaveAutoReactivate"`,
      [req.auth.schoolId, req.params.userId, leaveType, startDate, expectedReturnDate, autoReactivate]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    await client.query(
      `UPDATE user_sessions SET revoked_at=NOW()
       WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
      [req.auth.schoolId, req.params.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_PLACE_TEACHER_ON_LEAVE','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ leaveType, startDate, expectedReturnDate, autoReactivate })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher leave update failed:', err.message);
    return res.status(500).json({ error: 'Could not place teacher on leave.' });
  } finally {
    client.release();
  }
});

// Manual early/late return from leave, or manual reactivation of an inactive teacher.
app.post('/api/teachers/:userId/return', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE school_users
       SET active=TRUE, teacher_status='ACTIVE', leave_type=NULL,
           leave_start_date=NULL, expected_return_date=NULL,
           leave_auto_reactivate=TRUE, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus"`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    const endedCovers = await client.query(
      `UPDATE teacher_period_substitutions
       SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
       WHERE school_id=$1 AND original_teacher_user_id=$2 AND status='ACTIVE'
       RETURNING substitution_id, period_id, substitute_teacher_user_id`,
      [req.auth.schoolId, req.params.userId]
    );
    for (const cover of endedCovers.rows) {
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_END_COVER_ON_TEACHER_RETURN','teacher_period_substitution',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, cover.substitution_id,         JSON.stringify({ periodId: cover.period_id, substituteTeacherUserId: cover.substitute_teacher_user_id, reason: 'Original teacher returned' })]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_RETURN_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ endedTemporaryCovers: endedCovers.rowCount })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: result.rows[0], endedTemporaryCovers: endedCovers.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher return failed:', err.message);
    return res.status(500).json({ error: 'Could not reactivate teacher account.' });
  } finally {
    client.release();
  }
});

// Create a date-limited substitute cover. The original teacher's permanent assignment is never changed.
app.post('/api/teachers/:userId/substitutions', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid original teacher account ID.' });
  const { substituteTeacherUserId, periodId, startDate, endDate } = req.body || {};
  if (!isUuid(substituteTeacherUserId) || !isUuid(periodId) ||
      !isValidSchoolDate(startDate) || !isValidSchoolDate(endDate) || endDate < startDate ||
      String(req.params.userId) === String(substituteTeacherUserId)) {
    return res.status(400).json({ error: 'Select a substitute teacher, class schedule, and valid coverage dates.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const original = await client.query(
      `SELECT user_id, display_name, teacher_status, active, department_id,
              to_char(leave_start_date, 'YYYY-MM-DD') AS leave_start_date,
              to_char(expected_return_date, 'YYYY-MM-DD') AS expected_return_date,
              leave_auto_reactivate
       FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       FOR UPDATE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!original.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Original teacher was not found in this school.' });
    }
    const absent = original.rows[0];
    const schoolToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const onSavedLeave = !absent.active && absent.teacher_status === 'ON_LEAVE' &&
      absent.leave_start_date && absent.expected_return_date &&
      startDate >= absent.leave_start_date && endDate <= absent.expected_return_date &&
      !(absent.leave_auto_reactivate && endDate >= absent.expected_return_date);
    if (!onSavedLeave && (startDate !== schoolToday || endDate !== schoolToday)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Unplanned teacher coverage is limited to the current school day.' });
    }
    const permanentAssignment = await client.query(
      `SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3`,
      [req.auth.schoolId, req.params.userId, periodId]
    );
    if (!permanentAssignment.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The selected class schedule is not permanently assigned to the teacher on leave.' });
    }
    const substitute = await client.query(
      `SELECT user_id, username, display_name, department_id FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND COALESCE(teacher_status, 'ACTIVE')='ACTIVE'
       FOR UPDATE`,
      [req.auth.schoolId, substituteTeacherUserId]
    );
    if (!substitute.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The substitute must be an active teacher in this school.' });
    }
    const period = await client.query(
      `SELECT period_id, period_name, subject_name, grade_level, section, classroom, department_id, start_time, end_time, grace_minutes,
              effective_from AS "effectiveFrom",effective_to AS "effectiveTo"
       FROM class_periods WHERE school_id=$1 AND period_id=$2 AND active=TRUE`,
      [req.auth.schoolId, periodId]
    );
    if (!period.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'The selected class schedule is not active.' });
    }
    if ((period.rows[0].effectiveFrom && startDate < String(period.rows[0].effectiveFrom).slice(0,10)) ||
        (period.rows[0].effectiveTo && endDate > String(period.rows[0].effectiveTo).slice(0,10))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Substitute coverage dates must fall within the class schedule effective dates.' });
    }
    if (String(period.rows[0].department_id) !== String(absent.department_id) ||
        String(substitute.rows[0].department_id) !== String(period.rows[0].department_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The original teacher, substitute, and schedule must belong to the same department.' });
    }
    if (req.auth.role === 'DEPARTMENT_HEAD' && (req.auth.departmentCode === 'UNASSIGNED' || String(period.rows[0].department_id) !== String(req.auth.departmentId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can provide teacher coverage only inside your own department.' });
    }
    if (!onSavedLeave) {
      const missingCheckIn = await client.query(
        `SELECT (
           (NOW() AT TIME ZONE 'Asia/Manila')::date=$3::date
           AND (NOW() AT TIME ZONE 'Asia/Manila')::time > p.start_time + make_interval(mins => p.grace_minutes)
           AND NOT EXISTS (
             SELECT 1 FROM teacher_gate_events tge
             WHERE tge.school_id=p.school_id AND tge.teacher_user_id=$2
               AND tge.school_date=$3::date AND tge.event_type='TIME_IN'
           )
         ) AS eligible
         FROM class_periods p WHERE p.school_id=$1 AND p.period_id=$4 AND p.active=TRUE`,
        [req.auth.schoolId, req.params.userId, schoolToday, periodId]
      );
      if (!missingCheckIn.rows[0]?.eligible) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A substitute can be assigned only after the class grace time passes without a verified teacher time-in.' });
      }
    }
    const alreadyPermanent = await client.query(
      `SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3`,
      [req.auth.schoolId, substituteTeacherUserId, periodId]
    );
    if (alreadyPermanent.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This teacher already has a permanent assignment to that class schedule.' });
    }
    const overlap = await client.query(
      `SELECT 1
       FROM teacher_period_substitutions existing
       JOIN class_periods existing_period
         ON existing_period.school_id=existing.school_id AND existing_period.period_id=existing.period_id
       WHERE existing.school_id=$1 AND existing.status='ACTIVE'
         AND daterange(existing.start_date, existing.end_date, '[]') && daterange($4::date, $5::date, '[]')
         AND daterange(COALESCE(existing_period.effective_from,'-infinity'::date),COALESCE(existing_period.effective_to,'infinity'::date),'[]')
             && daterange($4::date,$5::date,'[]')
         AND (
           (existing.period_id=$3 AND existing.original_teacher_user_id=$2)
           OR (existing.substitute_teacher_user_id=$6
               AND existing_period.start_time < $8::time AND $7::time < existing_period.end_time
               AND EXISTS (SELECT 1 FROM class_period_days a
                           JOIN class_period_days b ON b.school_id=a.school_id AND b.weekday=a.weekday
                           WHERE a.school_id=existing_period.school_id AND a.period_id=existing_period.period_id
                             AND b.period_id=$3))
           OR EXISTS (
             SELECT 1 FROM teacher_period_assignments permanent
             JOIN class_periods permanent_period
               ON permanent_period.school_id=permanent.school_id AND permanent_period.period_id=permanent.period_id
             WHERE permanent.school_id=$1 AND permanent.teacher_user_id=$6
               AND permanent.period_id <> $3 AND permanent_period.active=TRUE
               AND permanent_period.start_time < $8::time AND $7::time < permanent_period.end_time
               AND daterange(COALESCE(permanent_period.effective_from,'-infinity'::date),COALESCE(permanent_period.effective_to,'infinity'::date),'[]')
                   && daterange($4::date,$5::date,'[]')
               AND EXISTS (SELECT 1 FROM class_period_days a
                           JOIN class_period_days b ON b.school_id=a.school_id AND b.weekday=a.weekday
                           WHERE a.school_id=permanent_period.school_id AND a.period_id=permanent_period.period_id
                             AND b.period_id=$3)
           )
         )
       LIMIT 1`,
      [req.auth.schoolId, req.params.userId, periodId, startDate, endDate,
       substituteTeacherUserId, period.rows[0].start_time, period.rows[0].end_time]
    );
    if (overlap.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The selected teacher already has an overlapping substitute assignment for this time period.' });
    }
    const inserted = await client.query(
      `INSERT INTO teacher_period_substitutions
         (school_id, period_id, original_teacher_user_id, substitute_teacher_user_id,
          start_date, end_date, created_by_user_id)
       VALUES($1,$2,$3,$4,$5::date,$6::date,$7)
       RETURNING substitution_id AS "substitutionId",
                 to_char(start_date,'YYYY-MM-DD') AS "startDate",
                 to_char(end_date,'YYYY-MM-DD') AS "endDate"`,
      [req.auth.schoolId, periodId, req.params.userId, substituteTeacherUserId,
       startDate, endDate, req.auth.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_OR_DEPARTMENT_HEAD_ASSIGN_TEMPORARY_SUBSTITUTE','teacher_period_substitution',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, inserted.rows[0].substitutionId,
       JSON.stringify({ originalTeacher: absent.display_name,
         substituteTeacher: substitute.rows[0].display_name,
         periodName: period.rows[0].period_name, startDate, endDate })]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      substitution: {
        ...inserted.rows[0], periodId,
        periodName: period.rows[0].period_name,
        substituteTeacherName: substitute.rows[0].display_name
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Temporary teacher substitution failed:', err.message);
    return res.status(500).json({ error: 'Could not assign the temporary substitute.' });
  } finally {
    client.release();
  }
});

// Cancel future/current coverage while retaining the audit record and the original assignment.
app.delete('/api/teacher-substitutions/:substitutionId', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.substitutionId)) return res.status(400).json({ error: 'Invalid substitution ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      const scope = await client.query(
        `SELECT p.department_id FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         WHERE ts.school_id=$1 AND ts.substitution_id=$2 AND ts.status='ACTIVE'`,
        [req.auth.schoolId, req.params.substitutionId]
      );
      if (!scope.rowCount || req.auth.departmentCode === 'UNASSIGNED' || String(scope.rows[0].department_id) !== String(req.auth.departmentId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You can manage substitute coverage only in your own department.' });
      }
    }
    const cancelled = await client.query(
      `UPDATE teacher_period_substitutions
       SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
       WHERE school_id=$1 AND substitution_id=$2 AND status='ACTIVE'
       RETURNING substitution_id, period_id, original_teacher_user_id, substitute_teacher_user_id,
                 to_char(start_date,'YYYY-MM-DD') AS start_date,
                 to_char(end_date,'YYYY-MM-DD') AS end_date`,
      [req.auth.schoolId, req.params.substitutionId]
    );
    if (!cancelled.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active substitute assignment was not found.' });
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_OR_DEPARTMENT_HEAD_CANCEL_TEMPORARY_SUBSTITUTE','teacher_period_substitution',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.substitutionId,
       JSON.stringify({ periodId: cancelled.rows[0].period_id,
         startDate: cancelled.rows[0].start_date, endDate: cancelled.rows[0].end_date })]
    );
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Temporary substitute cancellation failed:', err.message);
    return res.status(500).json({ error: 'Could not cancel the substitute assignment.' });
  } finally {
    client.release();
  }
});

app.post('/api/periods/bulk-assignments', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.periodIds) ? req.body.periodIds : []).filter(isUuid))];
  const teacherUserId = req.body?.teacherUserId;
  if (!ids.length || ids.length > 100 || ids.length !== (req.body?.periodIds || []).length || !isUuid(teacherUserId)) {
    return res.status(400).json({ error: 'Select 1–100 valid schedules and one teacher.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)', [req.auth.schoolId]);
    const selected = await client.query(
      `SELECT period_id AS "periodId",period_name AS "periodName",department_id AS "departmentId",
              start_time AS "startTime",end_time AS "endTime",
              effective_from AS "effectiveFrom",effective_to AS "effectiveTo",
              COALESCE((SELECT array_agg(day.weekday ORDER BY day.weekday)
                        FROM class_period_days day
                        WHERE day.school_id=class_periods.school_id AND day.period_id=class_periods.period_id),'{}') AS weekdays
       FROM class_periods WHERE school_id=$1 AND period_id=ANY($2::uuid[]) AND active=TRUE
       ORDER BY start_time FOR UPDATE`,
      [req.auth.schoolId, ids]
    );
    if (selected.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'One or more selected schedules are no longer active. Refresh and try again.' });
    }
    if (req.auth.role === 'DEPARTMENT_HEAD' &&
        (req.auth.departmentCode === 'UNASSIGNED' || selected.rows.some(p => String(p.departmentId) !== String(req.auth.departmentId)))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can bulk-assign teachers only to schedules in your own department.' });
    }
    const teacher = await client.query(
      `SELECT user_id,username,display_name,department_id FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND 'SUBJECT_TEACHER'=ANY(teacher_designations)`,
      [req.auth.schoolId, teacherUserId]
    );
    if (!teacher.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active Subject Teacher account not found.' });
    }
    if (selected.rows.some(p => String(p.departmentId) !== String(teacher.rows[0].department_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The teacher and every selected schedule must belong to the same department.' });
    }
    for (let i = 0; i < selected.rows.length; i += 1) {
      const p = selected.rows[i];
      for (let j = i + 1; j < selected.rows.length; j += 1) {
        const other = selected.rows[j];
        const sharesDay = (p.weekdays || []).some(day => (other.weekdays || []).map(Number).includes(Number(day)));
        const datesOverlap = (!p.effectiveTo || !other.effectiveFrom || p.effectiveTo >= other.effectiveFrom) &&
          (!other.effectiveTo || !p.effectiveFrom || other.effectiveTo >= p.effectiveFrom);
        if (sharesDay && datesOverlap && p.startTime < other.endTime && other.startTime < p.endTime) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'The selected schedules overlap each other. A teacher cannot cover overlapping periods.' });
        }
      }
      const owner = await client.query(
        `SELECT su.display_name FROM teacher_period_assignments a
         JOIN school_users su ON su.school_id=a.school_id AND su.user_id=a.teacher_user_id
         WHERE a.school_id=$1 AND a.period_id=$2 AND a.teacher_user_id<>$3 LIMIT 1`,
        [req.auth.schoolId, p.periodId, teacherUserId]
      );
      if (owner.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: p.periodName + ' already has a permanent teacher (' + owner.rows[0].display_name + ').' });
      }
      const conflict = await client.query(
        `SELECT p.period_name FROM teacher_period_assignments a
         JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
         WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND a.period_id<>$3 AND p.active=TRUE
           AND p.start_time < $5 AND $4 < p.end_time
           AND daterange(COALESCE(p.effective_from,'-infinity'::date),COALESCE(p.effective_to,'infinity'::date),'[]')
               && daterange(COALESCE((SELECT effective_from FROM class_periods WHERE school_id=$1 AND period_id=$3),'-infinity'::date),
                            COALESCE((SELECT effective_to FROM class_periods WHERE school_id=$1 AND period_id=$3),'infinity'::date),'[]')
           AND EXISTS (SELECT 1 FROM class_period_days existing_day
                       JOIN class_period_days selected_day ON selected_day.school_id=existing_day.school_id
                         AND selected_day.weekday=existing_day.weekday
                       WHERE existing_day.school_id=p.school_id AND existing_day.period_id=p.period_id
                         AND selected_day.period_id=$3)
         UNION ALL
         SELECT p.period_name FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
           AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date AND p.active=TRUE
           AND p.start_time < $5 AND $4 < p.end_time
           AND daterange(COALESCE(p.effective_from,'-infinity'::date),COALESCE(p.effective_to,'infinity'::date),'[]')
               && daterange(COALESCE((SELECT effective_from FROM class_periods WHERE school_id=$1 AND period_id=$3),'-infinity'::date),
                            COALESCE((SELECT effective_to FROM class_periods WHERE school_id=$1 AND period_id=$3),'infinity'::date),'[]')
           AND EXISTS (SELECT 1 FROM class_period_days existing_day
                       JOIN class_period_days selected_day ON selected_day.school_id=existing_day.school_id
                         AND selected_day.weekday=existing_day.weekday
                       WHERE existing_day.school_id=p.school_id AND existing_day.period_id=p.period_id
                         AND selected_day.period_id=$3)
         LIMIT 1`,
        [req.auth.schoolId, teacherUserId, p.periodId, p.startTime, p.endTime]
      );
      if (conflict.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Teacher has an overlapping schedule: ' + conflict.rows[0].period_name + '.' });
      }
    }
    for (const p of selected.rows) {
      await client.query(
        `INSERT INTO teacher_period_assignments(school_id,teacher_user_id,period_id)
         VALUES($1,$2,$3) ON CONFLICT(school_id,teacher_user_id,period_id) DO NOTHING`,
        [req.auth.schoolId, teacherUserId, p.periodId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,$3,'teacher_period_bulk_assignment',$4,$5::jsonb)`,
      [req.auth.schoolId, req.auth.userId,
       req.auth.role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD_BULK_ASSIGN_TEACHER' : 'SCHOOL_ADMIN_BULK_ASSIGN_TEACHER',
       teacherUserId, JSON.stringify({ periodIds: ids, departmentId: selected.rows[0].departmentId })]
    );
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, assigned: selected.rowCount, teacher: teacher.rows[0].display_name });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Bulk teacher schedule assignment failed:', err.message);
    return res.status(500).json({ error: 'Could not complete bulk teacher assignment.' });
  } finally { client.release(); }
});

app.post('/api/periods/:periodId/assignments', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req, res) => {
  const { teacherUserId } = req.body || {};
  if (!isUuid(req.params.periodId) || !isUuid(teacherUserId)) {
    return res.status(400).json({ error: 'A valid schedule ID and teacher account ID are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)', [req.auth.schoolId]);
    const period = await client.query(
      `SELECT period_id, period_name, department_id FROM class_periods
       WHERE school_id=$1 AND period_id=$2 AND active=TRUE FOR UPDATE`,
      [req.auth.schoolId, req.params.periodId]
    );
    if (!period.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active class schedule not found in this school.' });
    }
    if (req.auth.role === 'DEPARTMENT_HEAD' && (req.auth.departmentCode === 'UNASSIGNED' || String(period.rows[0].department_id) !== String(req.auth.departmentId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can assign teachers only to schedules in your own department.' });
    }
    const teacher = await client.query(
      `SELECT user_id, username, display_name, department_id FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND 'SUBJECT_TEACHER'=ANY(teacher_designations)`,
      [req.auth.schoolId, teacherUserId]
    );
    if (!teacher.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active teacher account not found in this school.' });
    }
    if (String(teacher.rows[0].department_id) !== String(period.rows[0].department_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The teacher and class schedule must belong to the same department.' });
    }
    // A class schedule has one permanent owner. Use the temporary-substitute workflow
    // when the permanent teacher is away; never create a second permanent owner.
    const existingOwner = await client.query(
      `SELECT su.display_name
       FROM teacher_period_assignments a
       JOIN school_users su ON su.school_id=a.school_id AND su.user_id=a.teacher_user_id
       WHERE a.school_id=$1 AND a.period_id=$2 AND a.teacher_user_id<>$3
       LIMIT 1`,
      [req.auth.schoolId, req.params.periodId, teacherUserId]
    );
    if (existingOwner.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `This schedule already has a permanent teacher (${existingOwner.rows[0].display_name}). Use temporary substitute coverage from that teacherâ€™s On Leave row instead.`
      });
    }
    const scheduleConflict = await client.query(
      `SELECT p.period_name
       FROM teacher_period_assignments existing
       JOIN class_periods p ON p.school_id=existing.school_id AND p.period_id=existing.period_id
       JOIN class_periods requested ON requested.school_id=$1 AND requested.period_id=$3
       WHERE existing.school_id=$1 AND existing.teacher_user_id=$2
         AND existing.period_id<>$3 AND p.active=TRUE
         AND p.start_time < requested.end_time AND requested.start_time < p.end_time
         AND daterange(COALESCE(p.effective_from,'-infinity'::date),COALESCE(p.effective_to,'infinity'::date),'[]')
             && daterange(COALESCE(requested.effective_from,'-infinity'::date),COALESCE(requested.effective_to,'infinity'::date),'[]')
         AND EXISTS (
           SELECT 1 FROM class_period_days existing_day
           JOIN class_period_days requested_day
             ON requested_day.school_id=existing_day.school_id AND requested_day.weekday=existing_day.weekday
           WHERE existing_day.school_id=p.school_id AND existing_day.period_id=p.period_id
             AND requested_day.period_id=requested.period_id
         )
       UNION ALL
       SELECT p.period_name
       FROM teacher_period_substitutions ts
       JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
       JOIN class_periods requested ON requested.school_id=$1 AND requested.period_id=$3
       WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
         AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
         AND ts.start_date <= COALESCE(requested.effective_to,'infinity'::date)
         AND p.active=TRUE
         AND p.start_time < requested.end_time AND requested.start_time < p.end_time
         AND daterange(COALESCE(p.effective_from,'-infinity'::date),COALESCE(p.effective_to,'infinity'::date),'[]')
             && daterange(COALESCE(requested.effective_from,'-infinity'::date),COALESCE(requested.effective_to,'infinity'::date),'[]')
         AND EXISTS (
           SELECT 1 FROM class_period_days existing_day
           JOIN class_period_days requested_day
             ON requested_day.school_id=existing_day.school_id AND requested_day.weekday=existing_day.weekday
           WHERE existing_day.school_id=p.school_id AND existing_day.period_id=p.period_id
             AND requested_day.period_id=requested.period_id
         )
       LIMIT 1`,
      [req.auth.schoolId, teacherUserId, req.params.periodId]
    );
    if (scheduleConflict.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Teacher is already assigned to an overlapping schedule: ${scheduleConflict.rows[0].period_name}.` });
    }
    const assignment = await client.query(
      `INSERT INTO teacher_period_assignments(school_id, teacher_user_id, period_id)
       VALUES($1,$2,$3)
       ON CONFLICT(school_id,teacher_user_id,period_id) DO NOTHING
       RETURNING assignment_id`,
      [req.auth.schoolId, teacherUserId, req.params.periodId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,$3,'teacher_period_assignment',$4,$5::jsonb)`,
      [req.auth.schoolId, req.auth.userId,
       req.auth.role === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD_ASSIGN_TEACHER_PERIOD' : 'SCHOOL_ADMIN_ASSIGN_TEACHER_PERIOD',
       `${teacherUserId}:${req.params.periodId}`,
       JSON.stringify({ teacherUsername: teacher.rows[0].username, periodName: period.rows[0].period_name, departmentId: period.rows[0].department_id })]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      alreadyAssigned: assignment.rowCount === 0,
      teacher: { userId: teacher.rows[0].user_id, username: teacher.rows[0].username, displayName: teacher.rows[0].display_name },
      period: { periodId: period.rows[0].period_id, periodName: period.rows[0].period_name }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher schedule assignment failed:', err.message);
    return res.status(500).json({ error: 'Could not assign teacher to schedule.' });
  } finally {
    client.release();
  }});

app.delete('/api/periods/:periodId/assignments/:teacherUserId', authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.periodId) || !isUuid(req.params.teacherUserId)) {
    return res.status(400).json({ error: 'Invalid schedule or teacher account ID.' });
  }
  const client = await pool.connect();
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Confirm your password to remove this assignment.' });
  const actor = await pool.query('SELECT password_hash FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE', [req.auth.schoolId, req.auth.userId]);
  if (!actor.rowCount || !await verifyPassword(password, actor.rows[0].password_hash)) return res.status(401).json({ error: 'Password confirmation failed. No changes were made.' });
  try {
    await client.query('BEGIN');
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      const scope = await client.query(
        `SELECT department_id FROM class_periods WHERE school_id=$1 AND period_id=$2`,
        [req.auth.schoolId, req.params.periodId]
      );
      if (!scope.rowCount || req.auth.departmentCode === 'UNASSIGNED' || String(scope.rows[0].department_id) !== String(req.auth.departmentId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You can change assignments only for schedules in your own department.' });
      }
    }
    const activeCover = await client.query(
      `SELECT 1 FROM teacher_period_substitutions
       WHERE school_id=$1 AND period_id=$2 AND original_teacher_user_id=$3
         AND status='ACTIVE' AND end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
       LIMIT 1`,
      [req.auth.schoolId, req.params.periodId, req.params.teacherUserId]
    );
    if (activeCover.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This permanent assignment has temporary coverage. End the substitute cover before removing the original assignment.' });
    }
    const removed = await client.query(
      `DELETE FROM teacher_period_assignments a
       USING class_periods p, school_users su
       WHERE a.school_id=$1 AND a.period_id=$2 AND a.teacher_user_id=$3
         AND p.school_id=a.school_id AND p.period_id=a.period_id
         AND su.school_id=a.school_id AND su.user_id=a.teacher_user_id AND su.role='TEACHER'
       RETURNING a.assignment_id`,
      [req.auth.schoolId, req.params.periodId, req.params.teacherUserId]
    );
    if (!removed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher assignment not found in this school.' });
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'DEPARTMENT_HEAD_UNASSIGN_TEACHER_PERIOD','teacher_period_assignment',$3,'{}'::jsonb)`,
      [req.auth.schoolId, req.auth.userId, `${req.params.teacherUserId}:${req.params.periodId}`]
    );
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher schedule unassignment failed:', err.message);
    return res.status(500).json({ error: 'Could not remove teacher assignment.' });
  } finally {
    client.release();
  }
});

const TEACHER_STUDENT_SCOPE = `
  (
    EXISTS (
      SELECT 1 FROM student_enrollments own
      JOIN school_years own_sy ON own_sy.school_id=own.school_id AND own_sy.school_year_id=own.school_year_id
      JOIN class_adviser_assignments own_ca ON own_ca.school_id=own.school_id AND own_ca.adviser_user_id=$2
         AND own_ca.grade_level=own.grade_level
      WHERE own.school_id=s.school_id AND own.student_id=s.student_id
        AND own.created_by_user_id=$2 AND own.section='Unassigned'
        AND own.enrollment_status='ENROLLED' AND own_sy.status='ACTIVE'
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_period_assignments a
      JOIN class_periods p
        ON p.school_id = a.school_id AND p.period_id = a.period_id AND p.active = TRUE
      WHERE a.school_id = s.school_id
        AND a.teacher_user_id = $2
        AND p.grade_level = COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND (p.section IS NULL OR p.section = COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
    )
    OR EXISTS (
      SELECT 1
      FROM class_adviser_assignments ca
      WHERE ca.school_id=s.school_id
        AND ca.adviser_user_id=$2
        AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section)
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_period_substitutions ts
      JOIN class_periods sp
        ON sp.school_id=ts.school_id AND sp.period_id=ts.period_id AND sp.active=TRUE
      WHERE ts.school_id=s.school_id
        AND ts.substitute_teacher_user_id=$2
        AND ts.status='ACTIVE'
        AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date
        AND sp.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND (sp.section IS NULL OR sp.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
    )
  )`;

async function isTeacherAssigned(client, schoolId, teacherId, periodId, schoolDate, occurredAt) {
  // Date-specific cover takes priority over permanent assignments only after it
  // was created. Offline scans captured before the adjustment keep their original owner.
  const override = await client.query(
    'SELECT adjustment_type,teacher_user_id,updated_at FROM schedule_day_adjustments ' +
    'WHERE school_id=$1 AND period_id=$2 AND school_date=$3::date LIMIT 1',
    [schoolId,periodId,schoolDate]
  );
  const adjustment=override.rows[0];
  if(adjustment && new Date(occurredAt)>=new Date(adjustment.updated_at)) {
    if(adjustment.adjustment_type==='CANCEL')return false;
    if(adjustment.teacher_user_id)return String(adjustment.teacher_user_id)===String(teacherId);
  }
  const result = await client.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3
     )
     OR EXISTS (
       SELECT 1 FROM teacher_period_substitutions ts
       WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND ts.period_id=$3
         AND $4::date BETWEEN ts.start_date AND ts.end_date
         AND (
           ts.status='ACTIVE'
           OR (ts.status='CANCELLED' AND ts.cancelled_at IS NOT NULL AND $5::timestamptz <= ts.cancelled_at)
         )
     )`,
    [schoolId, teacherId, periodId, schoolDate, occurredAt]
  );
  return result.rowCount > 0;
}

function localTimeHHMM(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso));
}
function isLateForPeriod(iso, period) {
  const [h, m] = localTimeHHMM(iso).split(':').map(Number);
  const [sh, sm] = String(period.start_time).slice(0, 5).split(':').map(Number);
  return (h * 60 + m) > (sh * 60 + sm + Number(period.grace_minutes || 0));
}
function isValidSchoolDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Readiness, not just liveness: deployment probes must fail when the primary DB is unavailable.
// Do not expose connection strings, user data, or backend credentials in the response.
const databaseReadiness = createDatabaseReadiness(pool);
app.get('/health', databaseReadiness);

// Read-only normalized/similar-name preview; always scoped to the authenticated school.
app.get('/api/sections/name-check', authenticateSchoolClient,
 requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'), async(req,res)=>{
 const gradeLevel=String(req.query.gradeLevel||'').trim(),name=String(req.query.name||'').trim();
 if(!/^Grade (?:[1-9]|1[0-2])$/.test(gradeLevel)||!name||name.length>100)
   return res.status(400).json({error:'Choose a valid grade and section name.'});
 try {
   const rows=await pool.query(
     'SELECT section_name AS "sectionName", active FROM school_sections WHERE school_id=$1 AND LOWER(BTRIM(grade_level))=LOWER(BTRIM($2)) ORDER BY section_name',
     [req.auth.schoolId,gradeLevel]);
   return res.json(inspectName(name,rows.rows));
 }catch(error){console.error('Section name check:',error.message);return res.status(500).json({error:'Could not check section names.'});}
});

// Read-only queue for School Admin; no automatic merge or change to linked records.
app.get('/api/sections/duplicate-review', authenticateSchoolClient,
 requireSchoolRoles('SCHOOL_ADMIN'), async(req,res)=>{
 try {
   const rows=await pool.query(
     'SELECT grade_level AS "gradeLevel", section_name AS "sectionName", active FROM school_sections WHERE school_id=$1 ORDER BY grade_level,section_name LIMIT 1000',
     [req.auth.schoolId]);
   const groups=new Map();
   rows.rows.forEach(item=>{
     const key=gradeKey(item.gradeLevel);
     if(!groups.has(key))groups.set(key,[]);
     groups.get(key).push(item);
   });
   const matches=[];
   for(const sections of groups.values())for(let i=0;i<sections.length;i++)for(let j=i+1;j<sections.length;j++){
     const a=sections[i],b=sections[j];
     if(sectionKey(a.sectionName)===sectionKey(b.sectionName))
       matches.push({gradeLevel:a.gradeLevel,first:a.sectionName,second:b.sectionName,type:'NORMALIZED_DUPLICATE'});
     else if(isSimilar(a.sectionName,b.sectionName))
       matches.push({gradeLevel:a.gradeLevel,first:a.sectionName,second:b.sectionName,type:'POSSIBLE_MATCH'});
   }
   return res.json({matches:matches.slice(0,100),truncated:rows.rows.length===1000||matches.length>100});
 }catch(error){console.error('Section duplicate review:',error.message);return res.status(500).json({error:'Could not review section names.'});}
});

// Grade-to-section options for student registration. Sections are derived from active class schedules.
app.post('/api/sections', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'), async (req,res) => {
 const gradeLevel=String(req.body?.gradeLevel||'').trim();
 const section=String(req.body?.section||'').trim();
 if (!/^Grade (?:[1-9]|1[0-2])$/.test(gradeLevel) || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,99}$/.test(section))
   return res.status(400).json({error:'Enter a valid grade and section name (up to 100 characters).'});
 const head=req.auth.role==='DEPARTMENT_HEAD';
 if(head&&(!req.auth.departmentId||req.auth.departmentCode==='UNASSIGNED'))
   return res.status(403).json({error:'An assigned department is required to register a class section.'});
 const client=await pool.connect();
 try {
   await client.query('BEGIN');
   const offered=await client.query('SELECT school_offers_grade($1,$2) AS allowed',[req.auth.schoolId,gradeLevel]);
   if(!offered.rows[0]?.allowed){await client.query('ROLLBACK');return res.status(409).json({error:'That grade is disabled for this school.'});}
   // Serialize section registration within this school; reject equivalent names
   // even if casing or surrounding whitespace differs.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16019)',[req.auth.schoolId]);
   const matching=await client.query(
     'SELECT section_name, active FROM school_sections WHERE school_id=$1 AND LOWER(BTRIM(grade_level))=LOWER(BTRIM($2)) AND school_section_identity_key(section_name)=school_section_identity_key($3) LIMIT 1',
     [req.auth.schoolId,gradeLevel,section]
   );
   // Retain the School Admin's existing ability to reactivate an exact archived entry.
   const reactivateExact=!head && matching.rowCount && matching.rows[0].active===false &&
     String(matching.rows[0].section_name)===section;
   if(matching.rowCount && !reactivateExact){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'This section already exists in the school-wide registry. Select it instead of creating another section.'});
   }
   // Similar names require an explicit confirmation; resemblance alone never merges records.
   const related=await client.query(
     'SELECT section_name AS "sectionName" FROM school_sections WHERE school_id=$1 AND LOWER(BTRIM(grade_level))=LOWER(BTRIM($2))',
     [req.auth.schoolId,gradeLevel]);
   const suggestions=inspectName(section,related.rows).similar.map(item=>item.sectionName);
   if(suggestions.length && req.body?.confirmSimilar!==true){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Similar sections exist. Review them before registering a new section.',similarSections:suggestions});
   }
   // Department Heads may register new school sections, but cannot reactivate or modify an existing one.
   const sql=head
     ? 'INSERT INTO school_sections(school_id,grade_level,section_name) VALUES($1,$2,$3) ON CONFLICT (school_id,grade_level,section_name) DO NOTHING RETURNING grade_level AS "gradeLevel",section_name AS section'
     : 'INSERT INTO school_sections(school_id,grade_level,section_name) VALUES($1,$2,$3) ON CONFLICT (school_id,grade_level,section_name) DO UPDATE SET active=TRUE RETURNING grade_level AS "gradeLevel",section_name AS section';
   const result=await client.query(sql,[req.auth.schoolId,gradeLevel,section]);
   if(!result.rowCount){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'This class section already exists for the selected grade.'});
   }
   if(head){
     await client.query(
       `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
       VALUES($1,'SCHOOL',$2,'DEPARTMENT_HEAD_CREATE_SECTION','school_section',$4,$3::jsonb)`,
       [req.auth.schoolId,req.auth.userId,JSON.stringify({gradeLevel,section,departmentId:req.auth.departmentId}),`${gradeLevel}:${section}`]);
   }
   await client.query('COMMIT');
   return res.status(201).json({section:result.rows[0]});
 } catch(err) {
   await client.query('ROLLBACK').catch(()=>{});
   if(err.code==='23505') return res.status(409).json({error:'An equivalent school section already exists. Select the existing section instead.'});
   console.error('Create section failed:',err.message);
   return res.status(500).json({error:'Could not create section.'});
 } finally {client.release();}
});

// Section edits are limited to unused registry entries; never rewrite learner or attendance history.
async function sectionIsReferenced(schoolId, gradeLevel, section) {
 const checks = await pool.query(`
 SELECT
 EXISTS(SELECT 1 FROM class_periods WHERE school_id=$1 AND grade_level=$2 AND section=$3) AS schedules,
 EXISTS(SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND grade_level=$2 AND section=$3) AS advisers,
 EXISTS(SELECT 1 FROM students WHERE school_id=$1 AND grade_level=$2 AND section=$3) AS students,
 EXISTS(SELECT 1 FROM student_enrollments WHERE school_id=$1 AND grade_level=$2 AND section=$3) AS enrollments
 `,[schoolId,gradeLevel,section]);
 return Object.values(checks.rows[0]).some(Boolean);
}
app.patch('/api/sections', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN'), async(req,res)=>{
 const gradeLevel=String(req.body?.gradeLevel||'').trim();
 const oldName=String(req.body?.section||'').trim();
 const newName=String(req.body?.newName||'').trim();
 if(!/^Grade (?:[1-9]|1[0-2])$/.test(gradeLevel)|| !oldName || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,99}$/.test(newName)) return res.status(400).json({error:'Invalid section name or grade.'});
 try {
  if(await sectionIsReferenced(req.auth.schoolId,gradeLevel,oldName)) return res.status(409).json({error:'This section is already used by learners or schedules. Rename requires a reviewed transfer to preserve existing records.'});
  const updated=await pool.query('UPDATE school_sections SET section_name=$4 WHERE school_id=$1 AND grade_level=$2 AND section_name=$3 AND active=TRUE RETURNING section_name',[req.auth.schoolId,gradeLevel,oldName,newName]);
  if(!updated.rowCount) return res.status(404).json({error:'Section not found in the official registry.'});
  return res.json({section:updated.rows[0].section_name});
 }catch(err){if(err.code==='23505')return res.status(409).json({error:'A section with this name already exists.'});console.error('Rename section:',err.message);return res.status(500).json({error:'Could not rename section.'});}
});
app.delete('/api/sections', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN'), async(req,res)=>{
 const gradeLevel=String(req.body?.gradeLevel||'').trim();
 const section=String(req.body?.section||'').trim();
 if(!gradeLevel||!section)return res.status(400).json({error:'Choose a grade and section.'});
 try{
  if(await sectionIsReferenced(req.auth.schoolId,gradeLevel,section))return res.status(409).json({error:'This section has linked learners or schedules and cannot be removed. Its historical records are protected.'});
  const updated=await pool.query('UPDATE school_sections SET active=FALSE WHERE school_id=$1 AND grade_level=$2 AND section_name=$3 AND active=TRUE RETURNING section_name',[req.auth.schoolId,gradeLevel,section]);
  if(!updated.rowCount)return res.status(404).json({error:'Section not found in the official registry.'});
  return res.json({archived:true,section});
 }catch(err){console.error('Archive section:',err.message);return res.status(500).json({error:'Could not remove section.'});}
});

app.get('/api/sections', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  const gradeLevel = typeof req.query.gradeLevel === 'string' ? req.query.gradeLevel.trim() : '';
  if (!gradeLevel || gradeLevel.length > 40) return res.status(400).json({ error: 'Select a valid grade level.' });
  try {
    const params = [req.auth.schoolId, gradeLevel];
    let sectionSql = '';
    if (req.auth.role === 'DEPARTMENT_HEAD') {
      if (!req.auth.departmentId || req.auth.departmentCode === 'UNASSIGNED') {
        return res.status(403).json({ error: 'Your account must be assigned to a department.' });
      }
      params.push(req.auth.departmentId);
      sectionSql = "SELECT TRIM(p.section) AS section FROM class_periods p WHERE p.school_id=$1 AND p.grade_level=$2 AND p.department_id=$3 AND p.active=TRUE AND p.section IS NOT NULL AND TRIM(p.section)<>''";
    } else if (req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      sectionSql = [
        "SELECT TRIM(p.section) AS section FROM class_periods p",
        "WHERE p.school_id=$1 AND p.grade_level=$2 AND p.active=TRUE AND p.section IS NOT NULL AND TRIM(p.section)<>''",
        "AND (EXISTS (SELECT 1 FROM teacher_period_assignments a WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)",
        "OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE' AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date))",
        "UNION SELECT TRIM(ca.section) AS section FROM class_adviser_assignments ca WHERE ca.school_id=$1 AND ca.grade_level=$2 AND ca.adviser_user_id=$3"
      ].join(" ");
    } else {
      sectionSql = [
        "SELECT TRIM(p.section) AS section FROM class_periods p WHERE p.school_id=$1 AND p.grade_level=$2 AND p.active=TRUE AND p.section IS NOT NULL AND TRIM(p.section)<>''",
        "UNION SELECT TRIM(ca.section) AS section FROM class_adviser_assignments ca WHERE ca.school_id=$1 AND ca.grade_level=$2",
        "UNION SELECT COALESCE(NULLIF(TRIM(en.section),''),NULLIF(TRIM(s.section),'')) AS section",
        "FROM students s LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE",
        "WHERE s.school_id=$1 AND s.active=TRUE AND s.archived_at IS NULL AND COALESCE(en.grade_level,s.grade_level)=$2"
      ].join(" ");
    }
    if (req.auth.role === 'DEPARTMENT_HEAD' || req.auth.role === 'TEACHER') {
      sectionSql += " UNION SELECT COALESCE(NULLIF(TRIM(en.section),''),NULLIF(TRIM(s.section),'')) AS section " +
        "FROM students s LEFT JOIN LATERAL (" +
        "SELECT e.grade_level,e.section FROM student_enrollments e " +
        "JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id " +
        "WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' " +
        "AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1" +
        ") en ON TRUE WHERE s.school_id=$1 AND s.active=TRUE AND s.archived_at IS NULL " +
        "AND COALESCE(en.grade_level,s.grade_level)=$2";
    }
    const result = await pool.query(
      "SELECT DISTINCT section FROM (" + sectionSql + " UNION SELECT section_name AS section FROM school_sections WHERE school_id=$1 AND grade_level=$2 AND active=TRUE) available_sections WHERE section IS NOT NULL AND TRIM(section)<>'' ORDER BY section",
      params
    );
    return res.json({ sections: result.rows.map(row => row.section) });
  } catch (err) {
    console.error('Section options failed:', err.message);
    return res.status(500).json({ error: 'Could not load sections.' });
  }
});

// Gate Keeper lookup resolves only the QR token presented at the entrance; it never downloads the full learner roster.
app.post('/api/gate/lookup', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.body?.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(400).json({ error: 'A valid student QR token is required.' });
  try {
    const result = await pool.query(
      `SELECT s.student_id AS "studentId",s.full_name AS "fullName",
              COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",COALESCE(en.section,s.section) AS section,
              s.qr_token AS "qrToken",(s.photo_path IS NOT NULL) AS "hasPhoto"
       FROM students s
       LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
       WHERE s.school_id=$1 AND s.qr_token=$2 AND s.active=TRUE LIMIT 1`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'QR code not found or learner is inactive.' });
    const student = result.rows[0];
    if (!student.hasPhoto) return res.status(409).json({ error: 'No registered learner photo is available. Ask the School Administrator to upload a photo before recording gate attendance.' });
    return res.json({ student: {
      studentId: student.studentId, fullName: student.fullName,
      gradeLevel: student.gradeLevel, section: student.section,
      qrToken: student.qrToken,
      photoUrl: `/api/gate/photo/${encodeURIComponent(qrToken)}`
    }});
  } catch (err) {
    console.error('Gate QR lookup failed:', err.message);
    return res.status(500).json({ error: 'Could not verify this student QR code.' });
  }
});

app.get('/api/gate/photo/:qrToken', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.params.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(404).end();
  try {
    const result = await pool.query(
      `SELECT student_id,photo_path FROM students
       WHERE school_id=$1 AND qr_token=$2 AND active=TRUE`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount || !result.rows[0].photo_path) return res.status(404).end();
    if (await readOfficialPhoto(pool,req.auth.schoolId,'STUDENT',result.rows[0].student_id,res)) return;
    const relative = result.rows[0].photo_path;
    const absolute = path.resolve(STUDENT_PHOTO_ROOT, relative);
    if (!absolute.startsWith(STUDENT_PHOTO_ROOT + path.sep)) return res.status(404).end();
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).end();
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Gate photo retrieval failed:', err.message);
    return res.status(404).end();
  }
});

// Gate Keeper teacher lookup is token-based; it never exposes a downloadable staff roster.
app.post('/api/gate/teacher-lookup', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.body?.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(400).json({ error: 'A valid teacher QR token is required.' });
  try {
    const result = await pool.query(
      `SELECT user_id AS "userId", username, display_name AS "fullName",
              teacher_designations AS "teacherDesignations", teacher_status AS "teacherStatus", role,
              (teacher_photo_path IS NOT NULL OR EXISTS (
                SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
                 AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text)) AS "hasPhoto"
       FROM school_users
       WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL') AND active=TRUE LIMIT 1`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Teacher QR code not found or account is inactive.' });
    const teacher = result.rows[0];
    if (!teacher.hasPhoto) return res.status(409).json({ error: 'No registered teacher photo is available. Ask the School Administrator to upload a photo before recording teacher gate attendance.' });
    // School-local, read-only status; QR Gatekeepers never receive medical details.
    const leaveStatus = gateVisibleLeave(await getStaffLeaveStatus(pool,req.auth.schoolId,teacher.userId));
    res.set('Cache-Control','no-store, private');
    return res.json({ teacher: {
      userId: teacher.userId, username: teacher.username, fullName: teacher.fullName,
      teacherDesignations: teacher.teacherDesignations || [], teacherStatus: teacher.teacherStatus, role: teacher.role,
      leaveStatus,
      photoUrl: `/api/gate/teacher/photo/${encodeURIComponent(qrToken)}`
    }});
  } catch (err) {
    console.error('Gate teacher QR lookup failed:', err.message);
    return res.status(500).json({ error: 'Could not verify this teacher QR code.' });
  }
});

app.get('/api/gate/teacher/photo/:qrToken', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.params.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(404).end();
  try {
    const result = await pool.query(
      `SELECT user_id,teacher_photo_path,
              (teacher_photo_path IS NOT NULL OR EXISTS (
                SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
                 AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text)) AS "hasPhoto"
       FROM school_users
       WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL') AND active=TRUE`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount || !result.rows[0].hasPhoto) return res.status(404).end();
    if (await readOfficialPhoto(pool,req.auth.schoolId,'STAFF',result.rows[0].user_id,res)) return;
    const absolute = path.resolve(TEACHER_PHOTO_ROOT, result.rows[0].teacher_photo_path);
    if (!absolute.startsWith(TEACHER_PHOTO_ROOT + path.sep)) return res.status(404).end();
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).end();
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Teacher gate photo retrieval failed:', err.message);
    return res.status(404).end();
  }
});

app.post('/api/gate/teacher-events', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const teacherUserId = String(req.body?.teacherUserId || '').trim();
  const eventType = String(req.body?.eventType || '').toUpperCase();
  // Legacy online route: browser date/time must never become an official timestamp.
  if (!isUuid(teacherUserId) || !['TIME_IN','TIME_OUT'].includes(eventType) ||
      req.body?.photoVerified !== true) {
    return res.status(400).json({ error: 'A verified teacher photo and valid time-in/time-out action are required.' });
  }
  try {
    const trustedClock=await pool.query(
      `SELECT instant AS "occurredAt",
       to_char(instant AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS "schoolDate"
       FROM (SELECT clock_timestamp() AS instant) trusted_clock`);
    const {occurredAt,schoolDate}=trustedClock.rows[0];
    const calendar = await pool.query(
      `SELECT exception_type AS type,dismissal_time AS "dismissalTime",updated_at AS "appliedAt"
       FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date`,
      [req.auth.schoolId,schoolDate]);
    const exception = calendar.rows[0];
    const exceptionAppliedBeforeEvent = exception && new Date(occurredAt) >= new Date(exception.appliedAt);
    if (exceptionAppliedBeforeEvent && exception?.type === 'CLOSED') return res.status(409).json({error:'Attendance is disabled because the school is marked closed on this date.'});
    if (exceptionAppliedBeforeEvent && exception?.type === 'SHORTENED_DAY' && exception.dismissalTime && eventType === 'TIME_IN' &&
        new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(occurredAt)) > String(exception.dismissalTime).slice(0,5))
      return res.status(409).json({error:'The recorded time is after the scheduled dismissal time for this shortened day.'});
    const teacher = await pool.query(
      `SELECT display_name FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL') AND active=TRUE
         AND (teacher_photo_path IS NOT NULL OR EXISTS (
            SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
             AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text))`,
      [req.auth.schoolId, teacherUserId]
    );
    if (!teacher.rowCount) return res.status(404).json({ error: 'Active teacher or registered teacher photo not found.' });
    if (eventType === 'TIME_OUT') {
      const timeIn = await pool.query(
        `SELECT occurred_at FROM teacher_gate_events
         WHERE school_id=$1 AND teacher_user_id=$2 AND school_date=$3::date AND event_type='TIME_IN'`,
        [req.auth.schoolId, teacherUserId, schoolDate]
      );
      if (!timeIn.rowCount) return res.status(409).json({ error: 'Record the teacher time-in before recording time-out.' });
      if (new Date(occurredAt) <= new Date(timeIn.rows[0].occurred_at)) return res.status(400).json({ error: 'Time-out must be later than the recorded time-in.' });
    }
    const saved = await pool.query(
      `INSERT INTO teacher_gate_events(school_id, teacher_user_id, event_type, occurred_at, school_date, recorded_by_user_id, photo_verified)
       VALUES($1,$2,$3,$4,$5::date,$6,TRUE)
       ON CONFLICT (school_id, teacher_user_id, school_date, event_type) DO NOTHING
       RETURNING event_id AS "eventId", event_type AS "eventType", occurred_at AS "occurredAt"`,
      [req.auth.schoolId, teacherUserId, eventType, occurredAt, schoolDate, req.auth.userId]
    );
    if (!saved.rowCount) return res.status(409).json({ error: `Teacher ${eventType.replace('_',' ').toLowerCase()} has already been recorded for this date.` });
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'GATE_KEEPER_RECORD_TEACHER_ATTENDANCE','teacher_gate_event',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, saved.rows[0].eventId, JSON.stringify({ teacherUserId, eventType, schoolDate, timestampSource:'SERVER' })]
    ).catch(err => console.error('Teacher gate audit log failed:', err.message));
    return res.status(201).json({ event: saved.rows[0], teacherName: teacher.rows[0].display_name, timestampSource:'SERVER' });
  } catch (err) {
    console.error('Teacher gate event failed:', err.message);
    return res.status(500).json({ error: 'Could not record teacher gate attendance.' });
  }
});

// Read-only preview of the next physical gate movement. Never modifies DTR or OB.
app.post('/api/gate/teacher-event-preview', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req,res) => {
  res.set('Cache-Control','no-store, private');
  const qrToken=String(req.body?.teacherQrToken||'').trim();
  if(!isUuid(qrToken))return res.status(400).json({error:'Valid staff QR badge required.'});
  try {
    const teacher=await pool.query(`SELECT user_id FROM school_users
      WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL')
      AND active=TRUE AND (teacher_photo_path IS NOT NULL OR EXISTS (
        SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
        AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text))`,
      [req.auth.schoolId,qrToken]);
    if(!teacher.rowCount)return res.status(404).json({error:'Active staff badge and registered photo required.'});
    const clock=await pool.query(`SELECT clock_timestamp() AS "now",
      to_char(clock_timestamp() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS "schoolDate",
      to_char(clock_timestamp() AT TIME ZONE 'Asia/Manila','HH24:MI') AS "localTime"`);
    const {now,schoolDate,localTime}=clock.rows[0];
    const calendar=await pool.query(`SELECT exception_type FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date`,[req.auth.schoolId,schoolDate]);
    if(calendar.rows.some(x=>x.exception_type==='CLOSED'))
      return res.json({status:'BLOCKED',reason:'School is closed on this date.',schoolDate});
    const history=await pool.query(`SELECT "eventType","occurredAt" FROM (
      SELECT CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
        occurred_at AS "occurredAt",event_id
      FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2
        AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED' AND school_date=$3::date
      UNION ALL
      SELECT event_type AS "eventType",occurred_at AS "occurredAt",event_id
      FROM teacher_gate_events WHERE school_id=$1 AND teacher_user_id=$2 AND school_date=$3::date
    ) movements ORDER BY "occurredAt",event_id`,[req.auth.schoolId,teacher.rows[0].user_id,schoolDate]);
    const {decideNextGateEvent}=require('./gate-event-decision');
    const decision=decideNextGateEvent(history.rows);
    if(decision.status!=='READY')return res.json({status:'REVIEW',reason:'Existing gate movements require authorized review.',schoolDate});
    const last=history.rows[history.rows.length-1];
    if(last && Date.parse(now)-Date.parse(last.occurredAt)<90000)
      return res.json({status:'RECENT_SCAN',reason:'A gate scan was recorded less than 90 seconds ago.',schoolDate});
    // AM/PM is a descriptive gate-time label, NOT a DTR slot assignment.
    const half=Number(localTime.slice(0,2))<12?'AM':'PM';
    return res.json({status:'READY',eventType:decision.eventType,
      label:half+' '+(decision.eventType==='TIME_IN'?'Time-In':'Time-Out'),
      localTime,schoolDate,recordingTarget:'PHYSICAL_GATE',
      note:'Gate movement only. Official DTR slots and approved OB are evaluated separately.'});
  }catch(err){
    console.error('Gate event preview failed:',err.message);
    return res.status(503).json({error:'Unable to preview gate attendance.'});
  }
});

// Automatic staff gate punch: strictly physical gate history, never OB or Form 48 DTR.
app.post('/api/gate/teacher-auto-event', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req,res) => {
  res.set('Cache-Control','no-store, private');
  const { validateAutomaticGateRecording, PHYSICAL_GATE } = require('./gate-attendance-boundary');
  const { decideNextGateEvent } = require('./gate-event-decision');
  const allowed=validateAutomaticGateRecording({
    actorRole:req.auth.role,photoVerified:req.body?.photoVerified,
    recordingTarget:PHYSICAL_GATE,clientEventType:req.body?.eventType
  });
  if(!allowed.allowed)return res.status(400).json({error:'Gate photo verification or recording request invalid.',reason:allowed.reason});
  // The prediction is advisory; the transaction still chooses the event.
  const expectedGateEventType=req.body?.expectedGateEventType;
  if(expectedGateEventType!==undefined && !['TIME_IN','TIME_OUT'].includes(expectedGateEventType))
    return res.status(400).json({error:'Invalid expected gate movement.'});
  const clientEventKey=String(req.body?.clientEventKey||'').trim();
  if(!isUuid(clientEventKey))return res.status(400).json({error:'An idempotent gate scan key is required.'});
  const qrToken=String(req.body?.teacherQrToken||'').trim();
  if(!isUuid(qrToken))return res.status(400).json({error:'A valid staff QR badge is required.'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const teacher=await client.query(`SELECT user_id,display_name FROM school_users
      WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL')
      AND active=TRUE AND (teacher_photo_path IS NOT NULL OR EXISTS (
       SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
       AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text))
      FOR SHARE`,[req.auth.schoolId,qrToken]);
    if(!teacher.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active staff badge and registered photo required.'});}
    const teacherId=teacher.rows[0].user_id;
    // Serialize gate scans per person and school; never trust browser history.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
      [String(req.auth.schoolId),String(teacherId)]);
    const recorded=await client.query(`SELECT event_id AS "eventId",staff_user_id AS "staffUserId",
      gate_direction AS "gateDirection",occurred_at AS "occurredAt"
      FROM staff_attendance_events WHERE school_id=$1 AND client_event_key=$2
        AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'`,
      [req.auth.schoolId,clientEventKey]);
    if(recorded.rowCount){
      if(String(recorded.rows[0].staffUserId)!==String(teacherId)){
        await client.query('ROLLBACK');
        return res.status(409).json({error:'Gate scan key is already in use.'});
      }
      const prior=recorded.rows[0];
      // A lost HTTP response must not turn a successful audited DTR into an
      // alarming "review needed" message when the Gatekeeper retries the same key.
      // Recover only an existing DTR linked to THIS physical gate event.
      let autoDtr={status:'REVIEW_REQUIRED',reason:'PREVIOUS_GATE_SCAN_NO_AUTO_DTR'};
      try {
        const linked=await client.query(`SELECT e.event_id AS "eventId",e.dtr_slot AS slot
          FROM staff_attendance_audit a
          JOIN staff_attendance_events e ON e.school_id=a.school_id AND e.event_id=a.target_id
          WHERE a.school_id=$1 AND a.action='AUTO_GATE_TO_DTR_VERIFIED'
            AND a.details->>'sourceGateEventId'=$2
            AND e.staff_user_id=$3 AND e.event_kind='DTR_SLOT'
            AND e.verification_status='VERIFIED'
          ORDER BY a.created_at DESC LIMIT 1`,
          [req.auth.schoolId,String(prior.eventId),teacherId]);
        if(linked.rowCount)autoDtr={status:'AUTO_RECORDED',
          slot:linked.rows[0].slot,eventId:linked.rows[0].eventId};
      } catch (lookupError) {
        console.error('Gate-to-DTR retry lookup:',lookupError.code||lookupError.name||'unknown');
      }
      await client.query('COMMIT');
      return res.status(200).json({event:{eventId:prior.eventId,
        eventType:prior.gateDirection==='IN'?'TIME_IN':'TIME_OUT',occurredAt:prior.occurredAt},
        teacherName:teacher.rows[0].display_name,recordingTarget:'PHYSICAL_GATE',
        autoDtr,alreadyRecorded:true});
    }
    const clock=await client.query(`SELECT clock_timestamp() AS occurred_at,
      to_char(clock_timestamp() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS school_date`);
    const occurredAt=clock.rows[0].occurred_at,schoolDate=clock.rows[0].school_date;
    const calendar=await client.query(`SELECT exception_type,dismissal_time FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date`,[req.auth.schoolId,schoolDate]);
    if(calendar.rows.some(x=>x.exception_type==='CLOSED')){
      await client.query('ROLLBACK');return res.status(409).json({error:'Gate attendance disabled for closed school date.'});
    }
    // Current authoritative physical movements plus pre-upgrade legacy records.
    // The legacy unique-per-type table is never written by this multi-entry path.
    const history=await client.query(`SELECT "eventType","occurredAt" FROM (
        SELECT CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
          occurred_at AS "occurredAt", event_id
          FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2
          AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
          AND school_date=$3::date
        UNION ALL
        SELECT event_type AS "eventType",occurred_at AS "occurredAt",event_id
          FROM teacher_gate_events WHERE school_id=$1 AND teacher_user_id=$2
          AND school_date=$3::date
      ) gate_history ORDER BY "occurredAt" ASC,event_id ASC`,
      [req.auth.schoolId,teacherId,schoolDate]);
    const decision=decideNextGateEvent(history.rows);
    if(decision.status!=='READY'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Existing gate history needs authorized review.',status:decision.status});
    }
    if(expectedGateEventType && expectedGateEventType!==decision.eventType){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Gate movement changed since verification. Scan the badge again to review the updated prediction.',status:'PREVIEW_CHANGED'});
    }
    // A double scan must never be mistaken for an actual return or departure.
    // Deliberate movements within this conservative interval require review.
    const last=history.rows[history.rows.length-1];
    if(last && Date.parse(occurredAt)-Date.parse(last.occurredAt)<90*1000){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Recent gate scan detected. Please wait before another scan or request authorized review.',status:'RECENT_SCAN'});
    }
    // Physical arrival must still be accepted after shortened dismissal or OB end.
    const eventId=require('node:crypto').randomUUID();
    const saved=await client.query(`INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,gate_direction,school_date,
       occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key)
      VALUES($1,$2,$3,'GATE_MOVEMENT',$4,$5::date,$6,
        'GATEKEEPER','VERIFIED','GUARD_PHOTO',$7,$8)
      RETURNING event_id AS "eventId",gate_direction AS "gateDirection",occurred_at AS "occurredAt"`,
      [eventId,req.auth.schoolId,teacherId,decision.eventType==='TIME_IN'?'IN':'OUT',
       schoolDate,occurredAt,req.auth.userId,clientEventKey]);
    const savedEvent={eventId:saved.rows[0].eventId,eventType:decision.eventType,
      occurredAt:saved.rows[0].occurredAt};
    await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
      VALUES($1,'SCHOOL',$2,'GATE_KEEPER_RECORD_TEACHER_ATTENDANCE','staff_attendance_event',$3,$4::jsonb)`,
      [req.auth.schoolId,req.auth.userId,eventId,
       JSON.stringify({teacherUserId:teacherId,eventType:decision.eventType,schoolDate,
         automatic:true,photoVerified:true,physicalGateOnly:true})]);
    // An unambiguous, photo-verified server-clock gate scan may also supply one
    // official DTR slot. This is an OPTIONAL audited projection, never an
    // inferred lunch punch, OB approval, absence, or overwritten slot.
    // SAVEPOINT ensures a projection failure cannot discard the real gate scan.
    let autoDtr={status:'REVIEW_REQUIRED',reason:'AUTO_MATCH_UNAVAILABLE'};
    try {
      await client.query('SAVEPOINT auto_gate_dtr');
      autoDtr=await require('./staff-gate-dtr-auto').autoRecordVerifiedGateDtr(client,{
        schoolId:req.auth.schoolId,staffUserId:teacherId,gateEventId:eventId,
        occurredAt:savedEvent.occurredAt,schoolDate,actorUserId:req.auth.userId
      });
      await client.query('RELEASE SAVEPOINT auto_gate_dtr');
    } catch (autoError) {
      await client.query('ROLLBACK TO SAVEPOINT auto_gate_dtr');
      await client.query('RELEASE SAVEPOINT auto_gate_dtr');
      console.error('Gate-to-DTR review fallback:',autoError.code||autoError.name||'unknown');
    }
    await client.query('COMMIT');
    return res.status(201).json({event:savedEvent,teacherName:teacher.rows[0].display_name,
      schoolDate,recordingTarget:'PHYSICAL_GATE',autoDtr});
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Automatic staff gate event:',err.message);
    return res.status(503).json({error:'Unable to record verified gate attendance.'});
  }finally{client.release();}
});

// Roster: school-scoped for all principals; teacher results are limited to their assigned grade/sections.
// Device clients receive only the fields needed for offline QR matching (no parent contact data).
app.get('/api/students', authenticateSchoolClient, requireSchoolClient, requireSchoolPermission('students.view.all'), async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && !['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Parent accounts may only access their approved linked children.' });
  }
  try {
    const params = [req.auth.schoolId];
    let scope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      scope = ` AND (${TEACHER_STUDENT_SCOPE} OR EXISTS (
        SELECT 1 FROM student_enrollments own
        JOIN school_years own_sy ON own_sy.school_id=own.school_id AND own_sy.school_year_id=own.school_year_id
        JOIN class_adviser_assignments own_ca ON own_ca.school_id=own.school_id
          AND own_ca.adviser_user_id=$2 AND own_ca.grade_level=own.grade_level
        WHERE own.school_id=s.school_id AND own.student_id=s.student_id AND own.created_by_user_id=$2
          AND own.enrollment_status='ENROLLED' AND own_sy.status='ACTIVE'
      ))`;
    }
    const includeParentFields = req.auth.type === 'SCHOOL_USER' && req.auth.role === 'SCHOOL_ADMIN';
    const isGateKeeper = req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER';
    const includeInactive = req.auth.type === 'SCHOOL_USER' && req.auth.role === 'SCHOOL_ADMIN' && req.query.includeInactive === 'true';
    const canScanQr = req.auth.type === 'DEVICE' || req.auth.role === 'SCHOOL_ADMIN' ||
      (req.auth.role === 'TEACHER' && req.auth.teacherDesignations?.includes('SUBJECT_TEACHER'));
    if (isGateKeeper) return res.status(403).json({ error: 'Gate Keeper accounts use QR lookup only and cannot download the learner roster.' });
    // Family details are school-user-only and always scoped by the existing roster permissions.
    // Never expose parent contacts to device or gate-scanner sessions.
    const sf1FamilyFields = ', s.lrn, s.parent_name AS "parentName", s.parent_mobile AS "parentMobile", s.father_name AS "fatherName", s.mother_maiden_name AS "motherMaidenName", s.sf1_guardian_name AS "sf1GuardianName", s.birth_date AS "birthDate", s.sf1_address AS "sf1Address"';
    const parentFields = includeParentFields
      ? sf1FamilyFields + ', sa.username AS "studentAccountUsername", sa.active AS "studentAccountActive", sa.must_change_password AS "studentMustChangePassword"'
      : (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER'
        ? sf1FamilyFields
        : '');
    const qrField = canScanQr ? ', s.qr_token AS "qrToken"' : '';
    const result = await pool.query(
      `SELECT s.student_id AS "studentId", s.full_name AS "fullName",
              s.last_name AS "lastName",s.first_name AS "firstName",s.middle_name AS "middleName",
              COALESCE(active_enrollment.grade_level,s.grade_level) AS "gradeLevel", COALESCE(active_enrollment.section,s.section) AS section,
              s.sex, s.active, s.archived_at AS "archivedAt"${qrField},
              program.program_code AS "specialProgramCode", program.program_name AS "specialProgramName",
              active_enrollment.enrollment_id AS "enrollmentId",
               (s.photo_path IS NOT NULL) AS "hasPhoto", s.updated_at AS "updatedAt"${parentFields}
       FROM students s
       LEFT JOIN LATERAL (SELECT en.enrollment_id,en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
       LEFT JOIN LATERAL (SELECT p.program_code,p.program_name
          FROM student_special_programs sp
          JOIN special_program_types p ON p.school_id=sp.school_id AND p.program_type_id=sp.program_type_id
          WHERE sp.school_id=s.school_id AND sp.enrollment_id=active_enrollment.enrollment_id
            AND sp.is_primary=TRUE AND sp.status='ACTIVE'
          LIMIT 1) program ON TRUE
       ${includeParentFields ? 'LEFT JOIN student_accounts sa ON sa.school_id=s.school_id AND sa.student_id=s.student_id' : ''}
       WHERE s.school_id=$1 AND (s.active=TRUE OR ${includeInactive ? 'TRUE' : 'FALSE'})${scope}
       ORDER BY COALESCE(NULLIF(s.last_name,''),s.full_name),COALESCE(NULLIF(s.first_name,''),s.full_name),s.student_id`,
      params
    );
    res.json({ students: result.rows.map(student => ({
      ...student,
      photoUrl: student.hasPhoto ? `/api/students/${encodeURIComponent(student.studentId)}/photo?v=${encodeURIComponent(student.updatedAt?.toISOString?.() || student.updatedAt || '')}` : null
    })), fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Student roster failed:', err.message);
    res.status(500).json({ error: 'Could not load students.' });
  }
});

// Submitted structured components must reconstruct the same full name. Never
// guess first/middle boundaries from an unstructured legacy full_name.
function submittedStudentNameParts(body, fullName) {
  const keys=['lastName','firstName','middleName'];
  if(!keys.some(key=>Object.prototype.hasOwnProperty.call(body||{},key)))
    return {provided:false};
  if(typeof body.lastName!=='string'||typeof body.firstName!=='string'||
     (body.middleName!==undefined&&typeof body.middleName!=='string'))
    return {error:'Enter valid surname, first name and optional middle name.'};
  const tidy=value=>String(value||'').trim().replace(/\s+/g,' ');
  const lastName=tidy(body.lastName),firstName=tidy(body.firstName);
  const middleName=tidy(body.middleName);
  if(!lastName||!firstName||lastName.length>100||firstName.length>160||
    middleName.length>160||[lastName,firstName,middleName].some(x=>x.includes(',')))
    return {error:'Surname and first name are required; check the component lengths.'};
  const composed=lastName+', '+firstName+(middleName?' '+middleName:'');
  if(composed!==tidy(fullName)||composed.length>200)
    return {error:'Name components must match the official formatted full name.'};
  return {provided:true,lastName,firstName,middleName};
}

// School admins and teachers may add students for continuity when an administrator is unavailable.
// Teachers may add ONLY new students to a grade/section covered by one of their assigned periods.
// A teacher cannot use this endpoint to edit an existing student or move a learner between sections.
// The school ID is always derived from the authenticated session, never from the request body.
app.post('/api/students', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  const { studentId, lrn, fullName, gradeLevel, section, sex, parentName, parentMobile } = req.body || {};
  const cleanSex = String(sex || '').trim().toUpperCase();
  const cleanParentName = typeof parentName === 'string' ? parentName.trim() : '';
  const cleanParentMobile = typeof parentMobile === 'string' ? parentMobile.trim() : '';
  const cleanLrn = typeof lrn === 'string' ? lrn.trim() : '';
  const requestedStudentId = typeof studentId === 'string' ? studentId.trim() : '';
  const nameParts=submittedStudentNameParts(req.body,fullName);
  if(nameParts.error)return res.status(400).json({error:nameParts.error});
  if ((studentId != null && typeof studentId !== 'string') ||
      ![fullName, gradeLevel, section, cleanParentName, cleanParentMobile].every(validText) ||
      requestedStudentId.length > 80 || String(fullName).trim().length > 200 ||
      String(gradeLevel).trim().length > 40 || String(section).trim().length > 100 ||
      cleanParentName.length > 160 || cleanParentMobile.length > 30 || cleanLrn.length > 30 ||
      !['MALE', 'FEMALE'].includes(cleanSex)) {
    return res.status(400).json({ error: 'Full name, Male/Female, grade, section, parent/guardian name, and a valid parent mobile number are required. Student ID is generated when left blank; LRN is optional and must be 30 characters or fewer.' });
  }
  const isTeacher = req.auth.role === 'TEACHER';
  if (isTeacher && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
    return res.status(403).json({ error: 'Only a designated Class Adviser may register learners in an assigned section.' });
  }
  const cleanGrade = gradeLevel.trim();
  const cleanSection = section.trim();
  let cleanStudentId = requestedStudentId;
  try {
    const offered = await pool.query('SELECT school_offers_grade($1,$2) AS allowed',[req.auth.schoolId,cleanGrade]);
    if(!offered.rows[0]?.allowed)
      return res.status(409).json({error:'This grade is not enabled in School Years & Enrollment → School levels.'});
    if (isTeacher) {
      const allowed = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM class_adviser_assignments ca
           WHERE ca.school_id=$1 AND ca.adviser_user_id=$2
             AND ca.grade_level=$3 AND ca.section=$4
         ) AS allowed`,
        [req.auth.schoolId, req.auth.userId, cleanGrade, cleanSection]
      );
      if (!allowed.rows[0]?.allowed) {
        return res.status(403).json({ error: 'You may register learners only in a section assigned to you as Class Adviser.' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const activeYear = await client.query("SELECT school_year_id, EXTRACT(YEAR FROM start_date)::int AS registration_year FROM school_years WHERE school_id=$1 AND status='ACTIVE'", [req.auth.schoolId]);
      // The year is the active school year's start year, or Manila calendar
      // year if this school has not activated a school year yet.
      const registrationYear = activeYear.rows[0]?.registration_year ||
        Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()));
      const masterGrade = activeYear.rowCount ? 'Unassigned' : cleanGrade;
      const masterSection = activeYear.rowCount ? 'Unassigned' : cleanSection;
      const qrToken = require('crypto').randomUUID();
      // Teachers cannot upsert an existing record; admins retain the legacy
      // same-school upsert only when they explicitly supply an existing ID.
      // Automatically generated IDs always use DO NOTHING so a collision can
      // never modify another student, including one belonging to this school.
      const conflictAction = (isTeacher || !requestedStudentId)
        ? 'ON CONFLICT(student_id) DO NOTHING'
        : `ON CONFLICT(student_id) DO UPDATE SET
             lrn=EXCLUDED.lrn, full_name=EXCLUDED.full_name, sex=EXCLUDED.sex, parent_name=EXCLUDED.parent_name,
             parent_mobile=EXCLUDED.parent_mobile,
             last_name=CASE WHEN students.full_name IS DISTINCT FROM EXCLUDED.full_name OR EXCLUDED.first_name IS NOT NULL
               THEN EXCLUDED.last_name ELSE students.last_name END,
             first_name=CASE WHEN students.full_name IS DISTINCT FROM EXCLUDED.full_name OR EXCLUDED.first_name IS NOT NULL
               THEN EXCLUDED.first_name ELSE students.first_name END,
             middle_name=CASE WHEN students.full_name IS DISTINCT FROM EXCLUDED.full_name OR EXCLUDED.first_name IS NOT NULL
               THEN EXCLUDED.middle_name ELSE students.middle_name END,
             name_parts_source=CASE WHEN students.full_name IS DISTINCT FROM EXCLUDED.full_name OR EXCLUDED.first_name IS NOT NULL
               THEN EXCLUDED.name_parts_source ELSE students.name_parts_source END,
             active=TRUE, updated_at=NOW()
           WHERE students.school_id=EXCLUDED.school_id`;
      let result = { rowCount: 0 };
      for (let attempt = 0; attempt < (requestedStudentId ? 1 : 20); attempt++) {
        if (!requestedStudentId) cleanStudentId = await nextStudentId(client, { year: registrationYear });
        result = await client.query(
          `INSERT INTO students(school_id, student_id, lrn, full_name, grade_level, section,
                               parent_name, parent_mobile, sex, qr_token,last_name,first_name,middle_name,name_parts_source)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ${conflictAction}
           RETURNING student_id AS "studentId", full_name AS "fullName", sex,
                     last_name AS "lastName",first_name AS "firstName",middle_name AS "middleName",
                     grade_level AS "gradeLevel", section, qr_token AS "qrToken"`,
          [req.auth.schoolId, cleanStudentId, cleanLrn || null, fullName.trim(), masterGrade,
           masterSection, cleanParentName, cleanParentMobile, cleanSex, qrToken,
           nameParts.provided?nameParts.lastName:null,nameParts.provided?nameParts.firstName:null,
           nameParts.provided?nameParts.middleName:null,nameParts.provided?'MANUAL':null]
        );
        if (result.rowCount) break;
      }
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: !requestedStudentId
          ? 'Could not allocate a unique student ID. Please retry.'
          : isTeacher
            ? 'That student ID is already in use. Teachers cannot edit existing student records.'
            : 'That student ID is already used by another school.' });
      }
      if (activeYear.rowCount) {
        await client.query(
          `INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'ENROLLED',$6)
           ON CONFLICT(school_id,student_id,school_year_id) DO UPDATE
           SET grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,updated_at=NOW()
           WHERE student_enrollments.enrollment_status='ENROLLED'`,
          [req.auth.schoolId, cleanStudentId, activeYear.rows[0].school_year_id, cleanGrade, cleanSection, req.auth.userId]
        );
      } else if (!isTeacher) {
        await client.query('UPDATE students SET grade_level=$3,section=$4 WHERE school_id=$1 AND student_id=$2',
          [req.auth.schoolId, cleanStudentId, cleanGrade, cleanSection]);
      }
      if (isTeacher) {
        await client.query(
          `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
           VALUES($1,'SCHOOL',$2,'TEACHER_CREATE_STUDENT','student',$3,$4::jsonb)`,
          [req.auth.schoolId, req.auth.userId, cleanStudentId,
           JSON.stringify({ gradeLevel: cleanGrade, section: cleanSection })]
        );
      }
      await client.query('COMMIT');
      return res.status(201).json({ student: { ...result.rows[0], gradeLevel: cleanGrade, section: cleanSection } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Student save failed:', err.message);
    if (err.code === '23514') return res.status(409).json({error:'That grade is not enabled for this school.'});
    if (err.code === 'STUDENT_ID_SERIES_EXHAUSTED') return res.status(409).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'That LRN is already registered.' });
    return res.status(500).json({ error: 'Could not save student.' });
  }
});

// Student IDs and private QR tokens are stable. Teachers may edit only learners within their own assignment scope.
// Subject Teachers may correct the learner name only. Class Advisers may also correct grade/section within their assigned section.
app.patch('/api/students/:studentId', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  const isTeacher = req.auth.role === 'TEACHER';
  const designations = Array.isArray(req.auth.teacherDesignations) ? req.auth.teacherDesignations : [];
  const isClassAdviser = isTeacher && designations.includes('CLASS_ADVISER');
  const isSubjectTeacher = isTeacher && designations.includes('SUBJECT_TEACHER');
  const { lrn, fullName, gradeLevel, section, sex, parentName, parentMobile, fatherName, motherMaidenName, sf1GuardianName, birthDate, sf1Address } = req.body || {};
  const nameParts=submittedStudentNameParts(req.body,fullName);
  if(nameParts.error)return res.status(400).json({error:nameParts.error});
  const cleanSex = String(sex || '').trim().toUpperCase();
  if (!validText(fullName) || fullName.trim().length > 200) {
    return res.status(400).json({ error: 'Provide a valid student full name.' });
  }
  if (!isTeacher && (!['MALE', 'FEMALE'].includes(cleanSex) || !validText(gradeLevel) || gradeLevel.trim().length > 40 ||
      !validText(section) || section.trim().length > 100 ||
      !validText(parentMobile) || parentMobile.trim().length > 30 ||
      !validText(parentName) || parentName.trim().length > 160 ||
      (lrn != null && (typeof lrn !== 'string' || lrn.trim().length > 30)))) {
    return res.status(400).json({ error: 'Provide valid student name, grade, section, and permitted student details.' });
  }
  if (!isTeacher) {
    // Only School Admin can edit extended SF1 fields. Absent fields preserve prior values.
    for (const [field, limit] of [['fatherName',160],['motherMaidenName',160],
      ['sf1GuardianName',160],['sf1Address',500]]) {
      const value = req.body?.[field];
      if (value !== undefined && (typeof value !== 'string' || value.trim().length > limit)) {
        return res.status(400).json({ error: 'Invalid SF1 field: ' + field });
      }
    }
    if (birthDate !== undefined &&
        (typeof birthDate !== 'string' ||
         (birthDate !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
            Number.isNaN(Date.parse(birthDate + 'T00:00:00Z')) ||
            new Date(birthDate + 'T00:00:00Z').toISOString().slice(0,10) !== birthDate)))) {
      return res.status(400).json({ error: 'Provide a valid date of birth (YYYY-MM-DD).' });
    }
  }
  if (isTeacher && !isClassAdviser && !isSubjectTeacher) {
    return res.status(403).json({ error: 'Your teacher account is not assigned to manage learner records.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isTeacher) {
      const scoped = await client.query(
        `SELECT s.grade_level AS "gradeLevel", s.section,
                EXISTS (SELECT 1 FROM class_adviser_assignments ca
                        WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3
                          AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section)) AS "isAdviserSection"
         FROM students s
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
           AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`,
        [req.auth.schoolId, req.params.studentId, req.auth.userId]
      );
      if (!scoped.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student not found in your assigned subject classes or advisory section.' });
      }

      const canChangePlacement = isClassAdviser && scoped.rows[0].isAdviserSection;
      let updated;
      if (canChangePlacement) {
        if (!validText(gradeLevel) || gradeLevel.trim().length > 40 || !validText(section) || section.trim().length > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Provide a valid grade and section.' });
        }
        const targetAllowed = await client.query(
          `SELECT EXISTS (SELECT 1 FROM class_adviser_assignments ca
                          WHERE ca.school_id=$1 AND ca.adviser_user_id=$2
                            AND ca.grade_level=$3 AND ca.section=$4) AS allowed`,
          [req.auth.schoolId, req.auth.userId, gradeLevel.trim(), section.trim()]
        );
        if (!targetAllowed.rows[0]?.allowed) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'You may move learners only within sections assigned to you as Class Adviser.' });
        }
        updated = await client.query(
          `UPDATE students s SET full_name=$4,
           last_name=CASE WHEN $5::text IS NOT NULL THEN $5
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.last_name END,
           first_name=CASE WHEN $5::text IS NOT NULL THEN $6
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.first_name END,
           middle_name=CASE WHEN $5::text IS NOT NULL THEN NULLIF($7::text,'')
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.middle_name END,
           name_parts_source=CASE WHEN $5::text IS NOT NULL THEN 'MANUAL'
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.name_parts_source END, updated_at=NOW()
           WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
             AND EXISTS (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
           RETURNING s.student_id AS "studentId", s.full_name AS "fullName", s.last_name AS "lastName",s.first_name AS "firstName",s.middle_name AS "middleName",
                     s.grade_level AS "gradeLevel", s.section, s.qr_token AS "qrToken"`,
          [req.auth.schoolId, req.params.studentId, req.auth.userId, fullName.trim(),
           nameParts.provided?nameParts.lastName:null,nameParts.provided?nameParts.firstName:null,
           nameParts.provided?nameParts.middleName:null]
        );
      } else {
        // Subject-only edit; the submitted payload cannot change placement or parent/LRN data.
        updated = await client.query(
          `UPDATE students s SET full_name=$4,
           last_name=CASE WHEN $5::text IS NOT NULL THEN $5
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.last_name END,
           first_name=CASE WHEN $5::text IS NOT NULL THEN $6
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.first_name END,
           middle_name=CASE WHEN $5::text IS NOT NULL THEN NULLIF($7::text,'')
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.middle_name END,
           name_parts_source=CASE WHEN $5::text IS NOT NULL THEN 'MANUAL'
             WHEN s.full_name IS DISTINCT FROM $4 THEN NULL ELSE s.name_parts_source END, updated_at=NOW()
           WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
             AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}
           RETURNING s.student_id AS "studentId", s.full_name AS "fullName", s.last_name AS "lastName",s.first_name AS "firstName",s.middle_name AS "middleName",
                     s.grade_level AS "gradeLevel", s.section, s.qr_token AS "qrToken"`,
          [req.auth.schoolId, req.params.studentId, req.auth.userId, fullName.trim(),
           nameParts.provided?nameParts.lastName:null,nameParts.provided?nameParts.firstName:null,
           nameParts.provided?nameParts.middleName:null]
        );
      }
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student was not found in your authorized classes.' });
      }
      if (canChangePlacement) {
        const activeYear = await client.query("SELECT school_year_id FROM school_years WHERE school_id=$1 AND status='ACTIVE'", [req.auth.schoolId]);
        if (activeYear.rowCount) {
          await client.query(
            `INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
             VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'ENROLLED',$6)
             ON CONFLICT(school_id,student_id,school_year_id) DO UPDATE
             SET grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,updated_at=NOW()
             WHERE student_enrollments.enrollment_status='ENROLLED'`,
            [req.auth.schoolId, req.params.studentId, activeYear.rows[0].school_year_id, gradeLevel.trim(), section.trim(), req.auth.userId]
          );
        } else {
          await client.query('UPDATE students SET grade_level=$3,section=$4 WHERE school_id=$1 AND student_id=$2',
            [req.auth.schoolId, req.params.studentId, gradeLevel.trim(), section.trim()]);
        }
      }
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'TEACHER_UPDATE_ASSIGNED_STUDENT','student',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.studentId,
         JSON.stringify({ nameUpdated: true, placementUpdated: canChangePlacement })]
      );
      await client.query('COMMIT');
      return res.json({ student: { ...updated.rows[0], ...(canChangePlacement ? { gradeLevel: gradeLevel.trim(), section: section.trim() } : {}) }, qrTokenPreserved: true, placementEditable: canChangePlacement });
    }

    const activeYear = await client.query("SELECT school_year_id FROM school_years WHERE school_id=$1 AND status='ACTIVE'", [req.auth.schoolId]);
    const updated = await client.query(
      `UPDATE students
       SET lrn=$3, full_name=$4,
           last_name=CASE WHEN $16::text IS NOT NULL THEN $16
             WHEN full_name IS DISTINCT FROM $4 THEN NULL ELSE last_name END,
           first_name=CASE WHEN $16::text IS NOT NULL THEN $17
             WHEN full_name IS DISTINCT FROM $4 THEN NULL ELSE first_name END,
           middle_name=CASE WHEN $16::text IS NOT NULL THEN NULLIF($18::text,'')
             WHEN full_name IS DISTINCT FROM $4 THEN NULL ELSE middle_name END,
           name_parts_source=CASE WHEN $16::text IS NOT NULL THEN 'MANUAL'
             WHEN full_name IS DISTINCT FROM $4 THEN NULL ELSE name_parts_source END,
           grade_level=CASE WHEN $10 THEN grade_level ELSE $5 END,
           section=CASE WHEN $10 THEN section ELSE $6 END,
           parent_name=$7, parent_mobile=$8, sex=$9,
           father_name=CASE WHEN $11::text IS NULL THEN father_name ELSE NULLIF(BTRIM($11::text),'') END,
           mother_maiden_name=CASE WHEN $12::text IS NULL THEN mother_maiden_name ELSE NULLIF(BTRIM($12::text),'') END,
           sf1_guardian_name=CASE WHEN $13::text IS NULL THEN sf1_guardian_name ELSE NULLIF(BTRIM($13::text),'') END,
           birth_date=CASE WHEN $14::text IS NULL THEN birth_date ELSE NULLIF($14::text,'')::date END,
           sf1_address=CASE WHEN $15::text IS NULL THEN sf1_address ELSE NULLIF(BTRIM($15::text),'') END,
           updated_at=NOW()
       WHERE school_id=$1 AND student_id=$2 AND active=TRUE
       RETURNING student_id AS "studentId", lrn, full_name AS "fullName",
                 last_name AS "lastName",first_name AS "firstName",middle_name AS "middleName",
                 grade_level AS "gradeLevel", section, parent_name AS "parentName",
                 parent_mobile AS "parentMobile", sex, qr_token AS "qrToken"`,
      [req.auth.schoolId, req.params.studentId, lrn?.trim() || null,
       fullName.trim(), gradeLevel.trim(), section.trim(),
       parentName?.trim() || null, parentMobile.trim(), cleanSex, Boolean(activeYear.rowCount),
       fatherName === undefined ? null : fatherName,
       motherMaidenName === undefined ? null : motherMaidenName,
       sf1GuardianName === undefined ? null : sf1GuardianName,
       birthDate === undefined ? null : birthDate,
       sf1Address === undefined ? null : sf1Address,
       nameParts.provided?nameParts.lastName:null,nameParts.provided?nameParts.firstName:null,
       nameParts.provided?nameParts.middleName:null]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found in your authorized school.' });
    }
    if (activeYear.rowCount) {
      await client.query(
        `INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
         VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'ENROLLED',$6)
         ON CONFLICT(school_id,student_id,school_year_id) DO UPDATE
         SET grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,updated_at=NOW()
         WHERE student_enrollments.enrollment_status='ENROLLED'`,
        [req.auth.schoolId, req.params.studentId, activeYear.rows[0].school_year_id, gradeLevel.trim(), section.trim(), req.auth.userId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_STUDENT','student',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.studentId,
       JSON.stringify({ gradeLevel: gradeLevel.trim(), section: section.trim(),
         sf1FieldsUpdated: ['fatherName','motherMaidenName','sf1GuardianName','birthDate','sf1Address']
           .filter(field => Object.prototype.hasOwnProperty.call(req.body || {}, field)) })]
    );
    await client.query('COMMIT');
    return res.json({ student: { ...updated.rows[0], ...(activeYear.rowCount ? { gradeLevel: gradeLevel.trim(), section: section.trim() } : {}) }, qrTokenPreserved: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'That LRN is already registered.' });
    if (err.code === '23514') return res.status(409).json({ error: 'That grade is not enabled for this school.' });
    console.error('Student update failed:', err.message);
    return res.status(500).json({ error: 'Could not update student information.' });
  } finally {
    client.release();
  }
});

// Student photos are stored outside /public and served only after school authentication.
const STUDENT_PHOTO_ROOT = path.join(__dirname, 'storage', 'student-photos');
const TEACHER_PHOTO_ROOT = path.join(__dirname, 'storage', 'teacher-photos');
function photoMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: '.png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

// Authenticated photo retrieval also supports gate devices so photos can be cached for offline use.
app.get('/api/students/:studentId/photo', authenticateSchoolClient, requireSchoolClient, async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && !['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'This account cannot access the school student photo roster.' });
  }
  try {
    const params = [req.auth.schoolId, req.params.studentId];
    let teacherScope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`;
    }
    const result = await pool.query(
      `SELECT photo_path FROM students s WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
      params
    );
    if (!result.rowCount || !result.rows[0].photo_path) return res.status(404).json({ error: 'Student photo not found.' });
    if (await readOfficialPhoto(pool,req.auth.schoolId,'STUDENT',req.params.studentId,res)) return;
    const relative = result.rows[0].photo_path;
    const absolute = path.resolve(STUDENT_PHOTO_ROOT, relative);
    if (!absolute.startsWith(STUDENT_PHOTO_ROOT + path.sep)) return res.status(404).json({ error: 'Student photo not found.' });
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).json({ error: 'Student photo not found.' });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String((await fsp.stat(absolute)).size));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Student photo retrieval failed:', err.message);
    return res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Could not retrieve student photo.' });
  }
});

// Upload or replace a student's photo. The binary request is capped at 5 MB and verified by file signature.
app.put('/api/students/:studentId/photo', authenticateSchoolClient, requireSchoolAdminOrTeacher,
  express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    if (req.auth.role === 'TEACHER' && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
      return res.status(403).json({ error: 'Only a designated Class Adviser may upload or replace learner photos.' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Select a JPG, PNG, or WebP photo (maximum 5 MB).' });
    const detected = photoMimeFromBuffer(req.body);
    if (!detected || req.headers['content-type'] !== detected.mime) {
      return res.status(415).json({ error: 'Unsupported photo. Upload a valid JPG, PNG, or WebP image.' });
    }
    try {
      const params = [req.auth.schoolId, req.params.studentId];
      let teacherScope = '';
      if (req.auth.role === 'TEACHER') {
        params.push(req.auth.userId);
        teacherScope = ` AND EXISTS (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))`;
      }
      const student = await pool.query(
        `SELECT s.student_id, s.photo_path FROM students s WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
        params
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Student not found in your authorized school/classes.' });
      const schoolDir = path.join(STUDENT_PHOTO_ROOT, String(req.auth.schoolId));
      await fsp.mkdir(schoolDir, { recursive: true });
      const filename = `${crypto.randomUUID()}${detected.ext}`;
      const absolute = path.join(schoolDir, filename);
      const relative = path.join(String(req.auth.schoolId), filename);
      await fsp.writeFile(absolute, req.body, { flag: 'wx', mode: 0o600 });
      try {
        await pool.query(
          `UPDATE students SET photo_path=$3, updated_at=NOW() WHERE school_id=$1 AND student_id=$2`,
          [req.auth.schoolId, req.params.studentId, relative]
        );
      } catch (dbError) {
        await fsp.unlink(absolute).catch(() => {});
        throw dbError;
      }
      if (student.rows[0].photo_path) {
        const oldPath = path.resolve(STUDENT_PHOTO_ROOT, student.rows[0].photo_path);
        if (oldPath.startsWith(STUDENT_PHOTO_ROOT + path.sep)) await fsp.unlink(oldPath).catch(() => {});
      }
      await pool.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_UPLOAD_STUDENT_PHOTO','student',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.studentId, JSON.stringify({ mimeType: detected.mime, bytes: req.body.length })]
      ).catch(err => console.error('Student photo audit log failed:', err.message));
      return res.json({ ok: true, photoUrl: `/api/students/${encodeURIComponent(req.params.studentId)}/photo?v=${Date.now()}` });
    } catch (err) {
      console.error('Student photo upload failed:', err.message);
      return res.status(500).json({ error: 'Could not save student photo.' });
    }
  }
);

// School Administrator manages private teacher photos and prints individual teacher gate QR badges.
app.put('/api/teachers/:userId/photo', authenticateSchoolClient, requireSchoolAdmin,
  express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Select a JPG, PNG, or WebP teacher photo (maximum 5 MB).' });
    const detected = photoMimeFromBuffer(req.body);
    if (!detected || req.headers['content-type'] !== detected.mime) return res.status(415).json({ error: 'Unsupported photo. Upload a valid JPG, PNG, or WebP image.' });
    try {
      const existing = await pool.query(
        `SELECT teacher_photo_path FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'`,
        [req.auth.schoolId, req.params.userId]
      );
      if (!existing.rowCount) return res.status(404).json({ error: 'Teacher account not found in this school.' });
      const schoolDir = path.join(TEACHER_PHOTO_ROOT, String(req.auth.schoolId));
      await fsp.mkdir(schoolDir, { recursive: true });
      const filename = `${crypto.randomUUID()}${detected.ext}`;
      const absolute = path.join(schoolDir, filename);
      const relative = path.join(String(req.auth.schoolId), filename);
      await fsp.writeFile(absolute, req.body, { flag: 'wx', mode: 0o600 });
      try {
        await pool.query(`UPDATE school_users SET teacher_photo_path=$3, updated_at=NOW() WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'`,
          [req.auth.schoolId, req.params.userId, relative]);
      } catch (dbError) { await fsp.unlink(absolute).catch(() => {}); throw dbError; }
      if (existing.rows[0].teacher_photo_path) {
        const oldPath = path.resolve(TEACHER_PHOTO_ROOT, existing.rows[0].teacher_photo_path);
        if (oldPath.startsWith(TEACHER_PHOTO_ROOT + path.sep)) await fsp.unlink(oldPath).catch(() => {});
      }
      await pool.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_UPLOAD_TEACHER_PHOTO','school_user',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ mimeType: detected.mime, bytes: req.body.length })]
      ).catch(err => console.error('Teacher photo audit log failed:', err.message));
      return res.json({ ok: true, hasTeacherPhoto: true });
    } catch (err) {
      console.error('Teacher photo upload failed:', err.message);
      return res.status(500).json({ error: 'Could not save teacher photo.' });
    }
  }
);

app.get('/api/teachers/:userId/qr', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id AS "userId", username, display_name AS "displayName",
              teacher_qr_token AS "qrToken", (teacher_photo_path IS NOT NULL) AS "hasTeacherPhoto"
       FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!result.rowCount || !result.rows[0].qrToken) return res.status(404).json({ error: 'Active teacher QR badge is not available.' });
    const teacher = result.rows[0];
    const qrCode = await QRCode.toDataURL(`TCH:${teacher.qrToken}`, { width: 360, margin: 2, errorCorrectionLevel: 'H' });
    return res.json({ teacher: { userId: teacher.userId, username: teacher.username, displayName: teacher.displayName, hasTeacherPhoto: teacher.hasTeacherPhoto }, qrCode });
  } catch (err) {
    console.error('Teacher QR generation failed:', err.message);
    return res.status(500).json({ error: 'Could not generate teacher gate QR.' });
  }
});

// QR images are returned only for a student in the authenticated school; teachers must be assigned to that student's class.
app.get('/api/students/:studentId/qr', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  try {
    if (
  req.auth.role === 'TEACHER' &&
  !req.auth.teacherDesignations?.some(d =>
    ['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(d)
  )
) {
  return res.status(403).json({ error: 'Only authorized teachers may view QR codes.' });
}
    const params = [req.auth.schoolId, req.params.studentId];
    let teacherScope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`;
    }
    const result = await pool.query(
      `SELECT s.qr_token AS token FROM students s
       WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
      params
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found in your authorized school/classes.' });
    const dataUrl = await QRCode.toDataURL(`JHS:${result.rows[0].token}`, {
      errorCorrectionLevel: 'H', margin: 2, width: 320
    });
    return res.json({ qrDataUrl: dataUrl });
  } catch (err) {
    console.error('QR generation failed:', err.message);
    return res.status(500).json({ error: 'Could not generate student QR code.' });
  }
});

app.get('/api/settings', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT setting_key, setting_value FROM school_settings WHERE school_id=$1',
      [req.auth.schoolId]
    );
    const settings = Object.fromEntries(result.rows.map(row => [row.setting_key, row.setting_value]));
    return res.json({
      schoolStartTime: settings.school_start_time?.time || null,
      schoolGraceMinutes: settings.school_start_time?.graceMinutes ?? 0
    });
  } catch (err) {
    console.error('Settings read failed:', err.message);
    return res.status(500).json({ error: 'Could not load settings.' });
  }
});

app.put('/api/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { schoolStartTime, schoolGraceMinutes = 0 } = req.body || {};
  if (!validText(schoolStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schoolStartTime) ||
      !Number.isInteger(Number(schoolGraceMinutes)) || Number(schoolGraceMinutes) < 0 || Number(schoolGraceMinutes) > 240) {
    return res.status(400).json({ error: 'Provide a valid school start time and grace minutes from 0 to 240.' });
  }
  try {
    await pool.query(
      `INSERT INTO school_settings(school_id, setting_key, setting_value)
       VALUES($1,'school_start_time',$2::jsonb)
       ON CONFLICT(school_id,setting_key)
       DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`,
      [req.auth.schoolId, JSON.stringify({ time: schoolStartTime, graceMinutes: Number(schoolGraceMinutes) })]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Settings save failed:', err.message);
    return res.status(500).json({ error: 'Could not save settings.' });
  }
});

// Department-owned subject catalogue. New schedules reference a canonical subject.
app.get('/api/subjects', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'), async (req, res) => {
  const departmentId = req.auth.role === 'SCHOOL_ADMIN'
    ? (typeof req.query.departmentId === 'string' ? req.query.departmentId : '')
    : req.auth.departmentId;
  if (req.auth.role !== 'SCHOOL_ADMIN' && req.query.departmentId &&
      String(req.query.departmentId) !== String(req.auth.departmentId)) {
    return res.status(403).json({ error: 'You can view subjects only in your assigned department.' });
  }
  if (!isUuid(departmentId)) return res.status(400).json({ error: 'Choose a teacher with an assigned department first.' });
  try {
    const result = await pool.query(
      "SELECT s.subject_id AS \"subjectId\",s.subject_name AS \"subjectName\",s.department_id AS \"departmentId\" " +
      "FROM school_subjects s JOIN school_departments d ON d.school_id=s.school_id AND d.department_id=s.department_id " +
      "WHERE s.school_id=$1 AND s.department_id=$2 AND s.active=TRUE AND d.active=TRUE ORDER BY s.subject_name",
      [req.auth.schoolId, departmentId]
    );
    return res.json({ subjects: result.rows });
  } catch (err) {
    console.error('Subject catalogue load failed:', err.message);
    return res.status(500).json({ error: 'Could not load department subjects.' });
  }
});

app.post('/api/subjects', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req, res) => {
  const departmentId = req.body?.departmentId;
  const subjectName = typeof req.body?.subjectName === 'string'
    ? req.body.subjectName.trim().replace(/\s+/g, ' ')
    : '';
  if (!isUuid(departmentId) || !subjectName || subjectName.length > 120) {
    return res.status(400).json({ error: 'Choose a department and enter a subject name (1–120 characters).' });
  }
  if (req.auth.role === 'DEPARTMENT_HEAD' &&
      (!req.auth.departmentId || req.auth.departmentCode === 'UNASSIGNED' ||
       String(departmentId) !== String(req.auth.departmentId))) {
    return res.status(403).json({ error: 'You can add subjects only in your own department.' });
  }
  try {
    const department = await pool.query(
      "SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE",
      [req.auth.schoolId, departmentId]
    );
    if (!department.rowCount) return res.status(404).json({ error: 'Active department not found.' });
    const result = await pool.query(
      "INSERT INTO school_subjects(school_id,department_id,subject_name) VALUES($1,$2,$3) " +
      "RETURNING subject_id AS \"subjectId\",subject_name AS \"subjectName\",department_id AS \"departmentId\"",
      [req.auth.schoolId, departmentId, subjectName]
    );
    return res.status(201).json({ subject: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That subject already exists in this department. Select the existing subject instead.' });
    }
    console.error('Subject creation failed:', err.message);
    return res.status(500).json({ error: 'Could not add the subject.' });
  }
});

app.get('/api/periods', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'), async (req, res) => {
  try {
    const params = [req.auth.schoolId];
    let teacherScope = '';
    if (req.auth.role === 'TEACHER') {
      const weekDate = isValidSchoolDate(req.query.weekDate)
        ? req.query.weekDate : new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
      params.push(req.auth.userId,weekDate);
      teacherScope = " AND (" +
        "EXISTS (SELECT 1 FROM teacher_period_assignments a WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$2) " +
        "OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE' AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date) " +
        "OR EXISTS (SELECT 1 FROM schedule_day_adjustments a WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$2 AND a.school_date BETWEEN date_trunc('week',$3::date)::date AND (date_trunc('week',$3::date)::date + 6)) " +
        "OR EXISTS (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=p.school_id AND ca.adviser_user_id=$2 AND ca.grade_level=p.grade_level AND ca.section=p.section))";
    }
    const result = await pool.query(
      "SELECT p.period_id AS \"periodId\",p.period_name AS \"periodName\",p.grade_level AS \"gradeLevel\",p.section," +
      "p.subject_id AS \"subjectId\",p.subject_name AS \"subjectName\",p.schedule_type AS \"scheduleType\",p.classroom,p.department_id AS \"scheduleDepartmentId\",p.timetable_template_id AS \"timetableTemplateId\"," +
      "COALESCE(assignment.\"assignedDepartmentId\",p.department_id) AS \"departmentId\"," +
      "COALESCE(assigned_department.department_name,d.department_name,'Unassigned') AS \"departmentName\"," +
      "assignment.\"assignedTeacherUserId\",assignment.\"assignedTeacherName\"," +
      "to_char(p.start_time,'HH24:MI') AS \"startTime\",to_char(p.end_time,'HH24:MI') AS \"endTime\",p.grace_minutes AS \"graceMinutes\"," +
      "COALESCE((SELECT array_agg(d.weekday ORDER BY d.weekday) FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id),'{}') AS weekdays," +
      "to_char(p.effective_from,'YYYY-MM-DD') AS \"effectiveFrom\",to_char(p.effective_to,'YYYY-MM-DD') AS \"effectiveTo\" " +
      "FROM class_periods p " +
      "LEFT JOIN school_departments d ON d.school_id=p.school_id AND d.department_id=p.department_id " +
      "LEFT JOIN LATERAL (" +
      "SELECT COALESCE(ts.substitute_teacher_user_id,a.teacher_user_id) AS \"assignedTeacherUserId\"," +
      "COALESCE(substitute.display_name,original.display_name) AS \"assignedTeacherName\"," +
      "COALESCE(substitute.department_id,original.department_id) AS \"assignedDepartmentId\" " +
      "FROM teacher_period_assignments a " +
      "JOIN school_users original ON original.school_id=a.school_id AND original.user_id=a.teacher_user_id " +
      "LEFT JOIN LATERAL (SELECT tsub.substitute_teacher_user_id FROM teacher_period_substitutions tsub " +
      "WHERE tsub.school_id=a.school_id AND tsub.period_id=a.period_id AND tsub.original_teacher_user_id=a.teacher_user_id " +
      "AND tsub.status='ACTIVE' AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN tsub.start_date AND tsub.end_date " +
      "ORDER BY tsub.created_at DESC LIMIT 1) ts ON TRUE " +
      "LEFT JOIN school_users substitute ON substitute.school_id=a.school_id AND substitute.user_id=ts.substitute_teacher_user_id " +
      "WHERE a.school_id=p.school_id AND a.period_id=p.period_id ORDER BY a.assignment_id LIMIT 1" +
      ") assignment ON TRUE " +
      "LEFT JOIN school_departments assigned_department ON assigned_department.school_id=p.school_id AND assigned_department.department_id=assignment.\"assignedDepartmentId\" " +
      "WHERE p.school_id=$1 AND p.active=TRUE" + teacherScope +
      " ORDER BY p.start_time,p.grade_level,p.section,p.period_name",
      params
    );
    return res.json({ periods: result.rows });
  } catch (err) {
    console.error('Period list failed:', err.message);
    return res.status(500).json({ error: 'Could not load periods.' });
  }
});

// School Administrators own official class schedules; Department Heads assign teachers and manage temporary changes.

app.patch('/api/periods/:periodId', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req,res) => {
  if (!isUuid(req.params.periodId)) return res.status(400).json({error:'Invalid schedule ID.'});
  const {periodName,startTime,endTime} = req.body || {};
  const classroom = typeof req.body?.classroom === 'string' ? req.body.classroom.trim() : '';
  const weekdays = Array.isArray(req.body?.weekdays) ? [...new Set(req.body.weekdays.map(Number))] : [];
  const templateId=req.body?.timetableTemplateId||null,blockId=req.body?.timetableTemplatePeriodId||null;
  if (Boolean(templateId)!==Boolean(blockId) || (templateId&&(!isUuid(templateId)||!isUuid(blockId))))
    return res.status(400).json({error:'Choose both a valid school timetable and time block.'});
  if (!validText(periodName) || periodName.trim().length>120 || classroom.length>100 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime||'') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime||'') || startTime>=endTime ||
      !weekdays.length || weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)) {
    return res.status(400).json({error:'Enter a valid schedule label, start/end times, room and weekdays.'});
  }
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),16016)',[req.auth.schoolId]);
    const result=await client.query(
      "SELECT period_id,department_id,grade_level,section,timetable_template_id," +
      "to_char(start_time,'HH24:MI') AS original_start,to_char(end_time,'HH24:MI') AS original_end " +
      "FROM class_periods WHERE school_id=$1 AND period_id=$2 AND active=TRUE FOR UPDATE",
      [req.auth.schoolId,req.params.periodId]);
    if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Schedule not found.'});}
    const p=result.rows[0];
    if(req.auth.role==='DEPARTMENT_HEAD' && (!req.auth.departmentId || req.auth.departmentCode==='UNASSIGNED' || String(p.department_id)!==String(req.auth.departmentId))){
      await client.query('ROLLBACK');return res.status(403).json({error:'You may edit only schedules in your department.'});
    }
    let nextTemplateId=p.timetable_template_id;
    if(templateId){
      const approved=await client.query(
        "SELECT to_char(b.start_time,'HH24:MI') AS start_time,to_char(b.end_time,'HH24:MI') AS end_time,b.block_type " +
        "FROM timetable_templates t JOIN timetable_template_periods b ON b.school_id=t.school_id AND b.template_id=t.template_id " +
        "WHERE t.school_id=$1 AND t.template_id=$2 AND b.template_period_id=$3 AND t.active=TRUE",
        [req.auth.schoolId,templateId,blockId]);
      if(!approved.rowCount||['BREAK','LUNCH'].includes(approved.rows[0].block_type)||
        approved.rows[0].start_time!==startTime||approved.rows[0].end_time!==endTime){
        await client.query('ROLLBACK');return res.status(409).json({error:'The approved timetable block is missing or its times changed.'});
      }
      nextTemplateId=templateId;
    } else if(startTime!==p.original_start||endTime!==p.original_end) {
      if(req.auth.role==='DEPARTMENT_HEAD'){
        await client.query('ROLLBACK');return res.status(403).json({error:'Department Heads can change time only by selecting an approved block.'});
      }
      nextTemplateId=null;
    }
    if(req.auth.role==='DEPARTMENT_HEAD'){
      const allowedRows=await client.query('SELECT weekday FROM school_operating_days WHERE school_id=$1 AND is_operating_day=TRUE',[req.auth.schoolId]);
      const allowed=new Set(allowedRows.rows.map(row=>Number(row.weekday)));
      if(weekdays.some(day=>!allowed.has(day))){
        await client.query('ROLLBACK');return res.status(403).json({error:'Class days must be within school operating days.'});
      }
    }
    const conflict=await client.query(
      `SELECT p.period_name,
        CASE WHEN lower(btrim(p.grade_level))=lower(btrim($3)) AND upper(btrim(p.section))=upper(btrim($4)) THEN 'section'
             WHEN $5<>'' AND upper(btrim(COALESCE(p.classroom,'')))=upper(btrim($5)) THEN 'classroom'
             ELSE 'teacher' END AS kind
       FROM class_periods p
       WHERE p.school_id=$1 AND p.period_id<>$2 AND p.active=TRUE
         AND p.start_time<$7::time AND $6::time<p.end_time
         AND EXISTS(SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id AND d.weekday=ANY($8::smallint[]))
         AND ((lower(btrim(p.grade_level))=lower(btrim($3)) AND upper(btrim(p.section))=upper(btrim($4)))
           OR ($5<>'' AND upper(btrim(COALESCE(p.classroom,'')))=upper(btrim($5)))
           OR EXISTS(SELECT 1 FROM teacher_period_assignments a JOIN teacher_period_assignments b
                ON a.school_id=b.school_id AND a.teacher_user_id=b.teacher_user_id
                WHERE a.school_id=$1 AND a.period_id=$2 AND b.period_id=p.period_id))
       LIMIT 1`,
      [req.auth.schoolId,req.params.periodId,p.grade_level,p.section,classroom,startTime,endTime,weekdays]);
    if(conflict.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Schedule conflicts with '+conflict.rows[0].period_name+' ('+conflict.rows[0].kind+').'});}
    await client.query(
      'UPDATE class_periods SET period_name=$3,start_time=$4::time,end_time=$5::time,classroom=$6,timetable_template_id=$7 WHERE school_id=$1 AND period_id=$2',
      [req.auth.schoolId,req.params.periodId,periodName.trim(),startTime,endTime,classroom||null,nextTemplateId]);
    await client.query('DELETE FROM class_period_days WHERE school_id=$1 AND period_id=$2',[req.auth.schoolId,req.params.periodId]);
    for(const day of weekdays) await client.query('INSERT INTO class_period_days(school_id,period_id,weekday) VALUES($1,$2,$3)',[req.auth.schoolId,req.params.periodId,day]);
    await client.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'UPDATE_CLASS_SCHEDULE','class_period',$3,$4::jsonb)",
      [req.auth.schoolId,req.auth.userId,req.params.periodId,JSON.stringify({periodName:periodName.trim(),startTime,endTime,classroom,weekdays})]);
    await client.query('COMMIT');
    return res.json({ok:true,message:'Schedule updated. Attendance history preserved.'});
  } catch(err){await client.query('ROLLBACK').catch(()=>{});console.error('Schedule edit failed:',err.message);return res.status(500).json({error:'Unable to update schedule.'});}
  finally{client.release();}
});

app.delete('/api/periods/:periodId', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req, res) => {
  if (!isUuid(req.params.periodId)) return res.status(400).json({ error: 'Invalid schedule ID.' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Confirm your password to delete this schedule.' });  const actor = await pool.query('SELECT password_hash FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE', [req.auth.schoolId, req.auth.userId]);
  if (!actor.rowCount || !await verifyPassword(password, actor.rows[0].password_hash)) return res.status(401).json({ error: 'Password confirmation failed. No changes were made.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query('SELECT period_id,period_name,department_id FROM class_periods WHERE school_id=$1 AND period_id=$2 AND active=TRUE FOR UPDATE', [req.auth.schoolId, req.params.periodId]);
    if (!target.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Active class schedule not found.' }); }
    if (req.auth.role === 'DEPARTMENT_HEAD' && (!req.auth.departmentId || req.auth.departmentCode === 'UNASSIGNED' || String(target.rows[0].department_id) !== String(req.auth.departmentId))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'You can delete schedules only within your own department.' }); }
    const cover = await client.query("SELECT 1 FROM teacher_period_substitutions WHERE school_id=$1 AND period_id=$2 AND status='ACTIVE' AND end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date LIMIT 1", [req.auth.schoolId, req.params.periodId]);
    if (cover.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'End active substitute coverage before deleting this schedule.' }); }
    await client.query('UPDATE class_periods SET active=FALSE WHERE school_id=$1 AND period_id=$2', [req.auth.schoolId, req.params.periodId]);
    await client.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'DEACTIVATE_CLASS_SCHEDULE','class_period',$3,$4::jsonb)", [req.auth.schoolId, req.auth.userId, req.params.periodId, JSON.stringify({periodName:target.rows[0].period_name,departmentId:target.rows[0].department_id,actorRole:req.auth.role})]);
    await client.query('COMMIT'); return res.json({ ok:true, message:'Schedule deactivated. Attendance history has been preserved.' });
  } catch (err) { await client.query('ROLLBACK'); console.error('Schedule deactivation failed:',err.message); return res.status(500).json({ error:'Could not delete this class schedule.' }); }
  finally { client.release(); }
});

app.post('/api/periods', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'), async (req, res) => {
  const isTeacher = req.auth.role === 'TEACHER';
  const isDepartmentHead = req.auth.role === 'DEPARTMENT_HEAD';
  const teacherUserId = isTeacher ? req.auth.userId : (req.body?.teacherUserId || null);
  const classroom = typeof req.body?.classroom === 'string' ? req.body.classroom.trim() : '';
  const { periodName, gradeLevel, section, subjectId, startTime, endTime } = req.body || {};
  // Department Heads may create schedules but cannot set attendance grace policy.
  // Use the existing five-minute creation default irrespective of a forged client value.
  const graceMinutes = isDepartmentHead ? 5 : (req.body?.graceMinutes ?? 0);
  const timetableTemplateId = req.body?.timetableTemplateId || null;
  const timetableTemplatePeriodId = req.body?.timetableTemplatePeriodId || null;
  const scheduleType = String(req.body?.scheduleType || 'CLASS').toUpperCase();
  // Server-side grade gate complements the migration trigger and the school UI.
  if(typeof gradeLevel==='string' && /^Grade (?:[7-9]|1[0-2])$/.test(gradeLevel)){
    try{
      const offered=await pool.query('SELECT school_offers_grade($1,$2) AS allowed',[req.auth.schoolId,gradeLevel]);
      if(!offered.rows[0]?.allowed)return res.status(409).json({error:'That grade is not offered by this school. Enable SHS in School Years & Enrollment first.'});
    }catch(e){console.error('School grade validation:',e.message);return res.status(503).json({error:'Could not verify the academic-level setting.'});}
  }
  if (!['CLASS','ADVISORY','OTHER'].includes(scheduleType)) return res.status(400).json({ error: 'Choose a valid schedule type.' });
  if (timetableTemplatePeriodId && !isUuid(timetableTemplatePeriodId)) return res.status(400).json({ error: 'Choose a valid time block.' });
  if (Boolean(timetableTemplateId) !== Boolean(timetableTemplatePeriodId)) return res.status(400).json({ error: 'Choose a saved timetable block, or use custom time.' });
  if (timetableTemplateId && !isUuid(timetableTemplateId)) return res.status(400).json({ error: 'Choose a valid timetable template.' });
  if (isDepartmentHead && !timetableTemplateId) return res.status(403).json({
    error:'Department Heads must select a School Admin-approved timetable block.'
  });
  let weekdays = Array.isArray(req.body?.weekdays) ? [...new Set(req.body.weekdays.map(Number))] : [];
  if (!weekdays.length) {
    const operating = await pool.query('SELECT weekday FROM school_operating_days WHERE school_id=$1 AND is_operating_day=TRUE ORDER BY weekday',[req.auth.schoolId]);
    weekdays = operating.rows.map(row => Number(row.weekday));
    if (!weekdays.length) weekdays = [1,2,3,4,5];
  }

  if (weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    return res.status(400).json({ error: 'Choose valid class weekdays.' });
  }
  if (isDepartmentHead) {
    const allowedRows=await pool.query('SELECT weekday FROM school_operating_days WHERE school_id=$1 AND is_operating_day=TRUE',[req.auth.schoolId]);
    const allowed=new Set(allowedRows.rows.map(row=>Number(row.weekday)));
    if (weekdays.some(day=>!allowed.has(day))) return res.status(403).json({
      error:'Select class days from the School Admin-approved operating days.'
    });
  }

  if (isTeacher && !req.auth.teacherDesignations?.includes('SUBJECT_TEACHER')) {
    return res.status(403).json({ error: 'Only a Subject Teacher may create a personal class schedule.' });
  }
  if ((teacherUserId && !isUuid(teacherUserId)) || !isUuid(subjectId) || (isTeacher && !teacherUserId)) {
    return res.status(400).json({ error: 'Choose a valid subject and, when assigning now, an active Subject Teacher.' });
  }
  if (![periodName, gradeLevel, section, startTime, endTime].every(validText) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      startTime >= endTime || !weekdays.length || !Number.isInteger(Number(graceMinutes)) ||
      Number(graceMinutes) < 0 || Number(graceMinutes) > 240 ||
      String(periodName).trim().length > 120 || String(gradeLevel).trim().length > 40 ||
      String(section).trim().length > 100 || classroom.length > 100) {
    return res.status(400).json({ error: 'Complete the period, subject, grade, section, and valid start/end times.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize schedule creation within this school so parallel form submissions cannot create conflicts.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)', [req.auth.schoolId]);

    let teacher = { rows: [], rowCount: 0 };
    if (teacherUserId) {
      teacher = await client.query(
        "SELECT su.user_id AS \"userId\",su.display_name AS \"displayName\",su.department_id AS \"departmentId\",d.department_name AS \"departmentName\",d.department_code AS \"departmentCode\" " +
        "FROM school_users su JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id " +
        "WHERE su.school_id=$1 AND su.user_id=$2 AND su.role='TEACHER' AND su.active=TRUE " +
        "AND 'SUBJECT_TEACHER'=ANY(su.teacher_designations) AND d.active=TRUE",
        [req.auth.schoolId, teacherUserId]
      );
      if (!teacher.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'The selected account is not an active Subject Teacher with an assigned department.' });
      }
      if (isTeacher && String(teacher.rows[0].userId) !== String(req.auth.userId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Subject Teachers may create schedules only for their own account.' });
      }
    }
    if (isTeacher && !teacherUserId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Subject Teachers must create schedules for their own account.' });
    }
    const subject = await client.query(
      "SELECT subject_id AS \"subjectId\",subject_name AS \"subjectName\",department_id AS \"departmentId\" FROM school_subjects " +
      "WHERE school_id=$1 AND subject_id=$2 AND active=TRUE",
      [req.auth.schoolId, subjectId]
    );
    if (!subject.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose an active subject from this school.' });
    }
    const departmentId = subject.rows[0].departmentId;
    if (isDepartmentHead &&
        (!req.auth.departmentId || req.auth.departmentCode === 'UNASSIGNED' ||
         String(departmentId) !== String(req.auth.departmentId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can create schedules only within your own department.' });
    }
    if (teacherUserId && String(teacher.rows[0].departmentId) !== String(departmentId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The selected teacher and subject must belong to the same department.' });
    }
    if (timetableTemplateId) {
      const template = await client.query(
        "SELECT p.period_label AS label,to_char(p.start_time,'HH24:MI') AS start_time," +
        "to_char(p.end_time,'HH24:MI') AS end_time,p.block_type AS block_type " +
        "FROM timetable_templates t JOIN timetable_template_periods p ON p.school_id=t.school_id AND p.template_id=t.template_id " +
        "WHERE t.school_id=$1 AND t.template_id=$2 AND p.template_period_id=$3 AND t.active=TRUE",
        [req.auth.schoolId, timetableTemplateId, timetableTemplatePeriodId]
      );
      if (!template.rowCount || ['BREAK','LUNCH'].includes(template.rows[0].block_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The saved timetable block is no longer available. Refresh your timetable selection.' });
      }
      const savedBlock = template.rows[0];
      if (savedBlock.start_time !== startTime || savedBlock.end_time !== endTime) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The selected timetable block has changed. Refresh and select the current school timetable time.' });
      }
    }
    // Subject ownership determines the schedule department, including unassigned schedules.
    if (String(subject.rows[0].departmentId) !== String(departmentId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose a subject belonging to the selected department.' });
    }

    // Period labels are descriptive only. Actual time intervals determine schedule conflicts.

    const sectionConflict = await client.query(
      "SELECT period_name,subject_name,start_time::text AS start_time,end_time::text AS end_time " +
      "FROM class_periods WHERE school_id=$1 AND active=TRUE " +
      "AND lower(btrim(grade_level))=lower(btrim($2)) AND upper(btrim(section))=upper(btrim($3)) " +
      "AND start_time < $5::time AND $4::time < end_time " +
      "AND EXISTS (SELECT 1 FROM class_period_days d WHERE d.school_id=class_periods.school_id AND d.period_id=class_periods.period_id AND d.weekday=ANY($6::smallint[])) LIMIT 1",
      [req.auth.schoolId, gradeLevel.trim(), section.trim(), startTime, endTime, weekdays]
    );
    if (sectionConflict.rowCount) {
      const conflict = sectionConflict.rows[0];
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: gradeLevel.trim() + ' · ' + section.trim() + ' already has ' + (conflict.subject_name || conflict.period_name) +
          ' from ' + String(conflict.start_time).slice(0,5) + ' to ' + String(conflict.end_time).slice(0,5) + '. Choose another time.'
      });
    }

    if (teacherUserId) {
      const teacherConflict = await client.query(
        "SELECT p.period_name,p.start_time::text AS start_time,p.end_time::text AS end_time " +
        "FROM teacher_period_assignments a JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id " +
        "WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND p.active=TRUE " +
        "AND p.start_time < $4::time AND $3::time < p.end_time " +
        "AND EXISTS (SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id AND d.weekday=ANY($5::smallint[])) " +
        "UNION ALL " +
        "SELECT p.period_name,p.start_time::text AS start_time,p.end_time::text AS end_time " +
        "FROM teacher_period_substitutions ts JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id " +
        "WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE' AND p.active=TRUE " +
        "AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date " +
        "AND p.start_time < $4::time AND $3::time < p.end_time " +
        "AND EXISTS (SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id AND d.weekday=ANY($5::smallint[])) LIMIT 1",
        [req.auth.schoolId, teacherUserId, startTime, endTime, weekdays]
      );
      if (teacherConflict.rowCount) {
        const conflict = teacherConflict.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: teacher.rows[0].displayName + ' already has ' + conflict.period_name + ' from ' +
            String(conflict.start_time).slice(0,5) + ' to ' + String(conflict.end_time).slice(0,5) + '.'
        });
      }
    }

    if (classroom) {
      const roomConflict = await client.query(
        "SELECT period_name,start_time::text AS start_time,end_time::text AS end_time FROM class_periods " +
        "WHERE school_id=$1 AND active=TRUE AND classroom IS NOT NULL " +
        "AND upper(btrim(classroom))=upper(btrim($2)) " +
        "AND start_time < $4::time AND $3::time < end_time " +
        "AND EXISTS (SELECT 1 FROM class_period_days d WHERE d.school_id=class_periods.school_id AND d.period_id=class_periods.period_id AND d.weekday=ANY($5::smallint[])) LIMIT 1",
        [req.auth.schoolId, classroom, startTime, endTime, weekdays]
      );
      if (roomConflict.rowCount) {
        const conflict = roomConflict.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: classroom + ' is already used for ' + conflict.period_name + ' from ' +
            String(conflict.start_time).slice(0,5) + ' to ' + String(conflict.end_time).slice(0,5) + '.'
        });
      }
    }

    const result = await client.query(
      "INSERT INTO class_periods(school_id,period_name,grade_level,section,subject_id,subject_name,start_time,end_time,grace_minutes,department_id,classroom,timetable_template_id,schedule_type) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) " +
      "RETURNING period_id AS \"periodId\",period_name AS \"periodName\",grade_level AS \"gradeLevel\",section," +
      "subject_id AS \"subjectId\",subject_name AS \"subjectName\",department_id AS \"departmentId\",classroom," +
      "to_char(start_time,'HH24:MI') AS \"startTime\",to_char(end_time,'HH24:MI') AS \"endTime\",schedule_type AS \"scheduleType\"",
      [req.auth.schoolId, periodName.trim(), gradeLevel.trim(), section.trim(), subjectId,
       subject.rows[0].subjectName, startTime, endTime, Number(graceMinutes), departmentId, classroom || null, timetableTemplateId, scheduleType]
    );
    const period = result.rows[0];
    for (const weekday of weekdays) {
      await client.query(
        "INSERT INTO class_period_days(school_id,period_id,weekday) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.auth.schoolId, period.periodId, weekday]
      );
    }
    if (teacherUserId) {
      await client.query(
        "INSERT INTO teacher_period_assignments(school_id,teacher_user_id,period_id) VALUES($1,$2,$3) " +
        "ON CONFLICT(school_id,teacher_user_id,period_id) DO NOTHING",
        [req.auth.schoolId, teacherUserId, period.periodId]
      );
    }
    await client.query(
      "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) " +
      "VALUES($1,'SCHOOL',$2,$3,'class_period',$4,$5::jsonb)",
      [req.auth.schoolId, req.auth.userId,
       isTeacher ? 'TEACHER_CREATE_OWN_PERIOD' : isDepartmentHead ? 'DEPARTMENT_HEAD_CREATE_DEPARTMENT_PERIOD' : 'SCHOOL_ADMIN_CREATE_PERIOD',
       period.periodId,
       JSON.stringify({
         periodName: period.periodName, subjectId, subjectName: period.subjectName,
         gradeLevel: period.gradeLevel, section: period.section, classroom,
         teacherUserId, teacherName: teacher.rows[0]?.displayName || null, departmentId
       })]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      period: { ...period, assignedTeacherUserId: teacherUserId, assignedTeacherName: teacher.rows[0]?.displayName || null,
        departmentName: teacher.rows[0]?.departmentName || null },
      assignedToCreator: isTeacher, teacher: teacher.rows[0]?.displayName || null,
      departmentName: teacher.rows[0]?.departmentName || null
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Period creation failed:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'This period or subject has already been added. Refresh the schedule list before saving again.' });
    return res.status(500).json({ error: 'Could not create the class schedule.' });
  } finally {
    client.release();
  }
});

// Teacher attendance history is limited to the signed-in teacher's adviser sections
// and permanent or active substitute subject periods. Gate records are never included.
app.get('/api/teacher/class-attendance', authenticateSchoolClient, requireSchoolRoles('TEACHER'), async (req, res) => {
  const designations = Array.isArray(req.auth.teacherDesignations) ? req.auth.teacherDesignations : [];
  const hasAdviser = designations.includes('CLASS_ADVISER');
  const hasSubject = designations.includes('SUBJECT_TEACHER');
  if (!hasAdviser && !hasSubject) {
    return res.status(403).json({ error: 'This account has no class-attendance designation.' });
  }

  const view = String(req.query.view || 'ALL').toUpperCase();
  if (!['ALL', 'ADVISORY', 'SUBJECT'].includes(view)) {
    return res.status(400).json({ error: 'Select All, Advisory, or Subject attendance.' });
  }
  if (view === 'ADVISORY' && !hasAdviser) {
    return res.status(403).json({ error: 'Only the assigned Class Adviser can view advisory attendance.' });
  }
  if (view === 'SUBJECT' && !hasSubject) {
    return res.status(403).json({ error: 'Only a Subject Teacher can view subject-class attendance.' });
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : today;
  if (!isValidSchoolDate(from) || !isValidSchoolDate(to) || from > to) {
    return res.status(400).json({ error: 'Provide a valid date range.' });
  }

  const includeAdvisory = hasAdviser && view !== 'SUBJECT';
  const includeSubject = hasSubject && view !== 'ADVISORY';
  try {
    const result = await pool.query(
      `SELECT e.event_id AS "eventId", e.student_id AS "studentId",
              s.full_name AS "fullName", COALESCE(active_enrollment.grade_level,s.grade_level) AS "gradeLevel",
              COALESCE(active_enrollment.section,s.section) AS section,
              e.school_date::text AS "schoolDate", e.occurred_at_device AS "occurredAt",
              e.attendance_scope AS scope, e.event_type AS "eventType", e.late,
              e.sync_status AS "syncStatus",
              p.period_name AS "periodName", p.subject_name AS "subjectName"
       FROM attendance_events e
       JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
       LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
       LEFT JOIN class_periods p ON p.school_id=e.school_id AND p.period_id=e.period_id
       WHERE e.school_id=$1 AND e.sync_status='ACCEPTED'
         AND e.attendance_scope IN ('CLASS','ADVISORY')
         AND e.school_date BETWEEN $2::date AND $3::date
         AND (
           ($4::boolean AND e.attendance_scope='ADVISORY'
             AND EXISTS (
               SELECT 1 FROM class_adviser_assignments ca
               WHERE ca.school_id=e.school_id AND ca.adviser_user_id=$5
                 AND ca.grade_level=COALESCE(active_enrollment.grade_level,s.grade_level) AND ca.section=COALESCE(active_enrollment.section,s.section)
             ))
           OR
           ($6::boolean AND e.attendance_scope='CLASS'
             AND (
               EXISTS (
                 SELECT 1 FROM teacher_period_assignments a
                 WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$5
               )
               OR EXISTS (
                 SELECT 1 FROM teacher_period_substitutions ts
                 WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                   AND ts.substitute_teacher_user_id=$5 AND ts.status='ACTIVE'
                   AND e.school_date BETWEEN ts.start_date AND ts.end_date
               )
             ))
         )
       ORDER BY e.school_date DESC, e.occurred_at_device DESC
       LIMIT 1500`,
      [req.auth.schoolId, from, to, includeAdvisory, req.auth.userId, includeSubject]
    );
    return res.json({ records: result.rows, count: result.rowCount, view, from, to });
  } catch (err) {
    console.error('Teacher class attendance history failed:', err.message);
    return res.status(500).json({ error: 'Could not load your assigned class attendance records.' });
  }
});

// School-scoped idempotent event ingestion. Gate Keepers/devices submit school-gate events;
// teachers submit only designated subject or advisory attendance. School Administrators do not scan.
app.post('/api/sync/events', authenticateSchoolClient, requireSchoolClient, async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'PARENT') {
    return res.status(403).json({ error: 'Parent accounts cannot submit or modify attendance events.' });
  }
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'DEPARTMENT_HEAD') {
    return res.status(403).json({ error: 'Department Head accounts are read-only and cannot submit attendance punches.' });
  }
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'SCHOOL_ADMIN') {
    return res.status(403).json({ error: 'School Administrator accounts do not record attendance. Use a Gate Keeper account for school-gate attendance or a designated teacher account for class attendance.' });
  }
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 500) {
    return res.status(400).json({ error: 'events must be an array containing 1 to 500 records.' });
  }
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    for (const event of events) {
      const automaticGate = event?.eventType === 'AUTO' &&
        req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER' &&
        event.attendanceScope === 'SCHOOL' && event.metadata?.photoVerified === true;
      if (!event || !event.eventId || !event.studentId || !event.eventType ||
          (!automaticGate && (!event.occurredAt || !isValidSchoolDate(event.schoolDate) ||
            !Number.isFinite(Date.parse(event.occurredAt)))) || !event.attendanceScope ||
          (!['TIME_IN', 'TIME_OUT'].includes(event.eventType) && !automaticGate) ||
          !['SCHOOL', 'CLASS', 'ADVISORY'].includes(event.attendanceScope) ||
          (event.attendanceScope === 'CLASS' && !event.periodId) ||
          (['SCHOOL', 'ADVISORY'].includes(event.attendanceScope) && event.periodId)) {
        results.push({ eventId: event?.eventId || null, status: 'REJECTED', reason: 'Invalid or missing event fields.' });
        continue;
      }
      if (req.auth.type === 'DEVICE' && event.attendanceScope !== 'SCHOOL') {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Gate device credentials may submit school-level attendance only.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && !['CLASS', 'ADVISORY'].includes(event.attendanceScope)) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teachers may submit subject or assigned advisory attendance only.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && event.attendanceScope === 'CLASS' && !req.auth.teacherDesignations?.includes('SUBJECT_TEACHER')) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'This teacher account is not designated to record subject attendance.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && event.attendanceScope === 'ADVISORY' && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'This teacher account is not designated to record advisory attendance.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER' && event.attendanceScope !== 'SCHOOL') {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Gate Keeper accounts may submit school-gate attendance only.' });
        continue;
      }

      const already = await client.query(
        'SELECT school_id,student_id,attendance_scope,event_type,occurred_at_device FROM attendance_events WHERE event_id=$1', [event.eventId]
      );
      if (already.rowCount) {
        if (String(already.rows[0].school_id) === String(req.auth.schoolId) &&
            String(already.rows[0].student_id) === String(event.studentId) &&
            already.rows[0].attendance_scope === event.attendanceScope) {
          results.push({ eventId: event.eventId, status: 'ALREADY_SYNCED',
            ...(automaticGate?{eventType:already.rows[0].event_type,
              occurredAt:already.rows[0].occurred_at_device}: {}) });
        } else {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Event ID belongs to a different school.' });
        }
        continue;
      }

      if (automaticGate) {
        // The Gatekeeper confirms identity; only the server selects the gate
        // direction and occurrence time. Never derive from browser state.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
          [String(req.auth.schoolId),'STUDENT_GATE:'+String(event.studentId)]);
        const clock=await client.query(`SELECT clock_timestamp() AS occurred_at,
          to_char(clock_timestamp() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS school_date`);
        event.occurredAt=clock.rows[0].occurred_at.toISOString();
        event.schoolDate=clock.rows[0].school_date;
        const prior=await client.query(`SELECT event_type AS "eventType",
            occurred_at_device AS "occurredAt"
          FROM attendance_events WHERE school_id=$1 AND student_id=$2
            AND school_date=$3::date AND attendance_scope='SCHOOL'
            AND sync_status='ACCEPTED'
          ORDER BY occurred_at_device ASC,event_id ASC`,
          [req.auth.schoolId,event.studentId,event.schoolDate]);
        const {decideNextGateEvent}=require('./gate-event-decision');
        // Student SCHOOL attendance currently has one verified arrival and
        // departure per day. Never create a third event without a policy review.
        const valid=prior.rows.length<=2?decideNextGateEvent(prior.rows):
          {status:'REVIEW'};
        if(valid.status!=='READY'||prior.rows.length>=2){
          results.push({eventId:event.eventId,status:'REJECTED',
            reason:'School gate attendance is already complete or requires authorized review.'});
          continue;
        }
        const previous=prior.rows[prior.rows.length-1];
        if(previous&&Date.parse(event.occurredAt)-Date.parse(previous.occurredAt)<90*1000){
          results.push({eventId:event.eventId,status:'REJECTED',
            reason:'Recent gate scan detected. Please wait or request authorized review.'});
          continue;
        }
        event.eventType=valid.eventType;
      }

      // A finalized class is immutable until the teacher explicitly reopens it.
      // Share the transaction advisory lock with manual edits and sign-offs to
      // prevent a delayed QR event racing a finalization into the register.
      if (event.attendanceScope === 'CLASS') {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
          [req.auth.schoolId, event.periodId + '|' + event.schoolDate]);
        const finalized = await client.query(
          'SELECT 1 FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 AND finalized=TRUE',
          [req.auth.schoolId, event.periodId, event.schoolDate]
        );
        if (finalized.rowCount) {
          results.push({ eventId:event.eventId, status:'REJECTED', code:'FINALIZED_REGISTER',
            reason:'Class register is finalized. Preserve the scan for teacher review before reopening.' });
          continue;
        }
      }
      const calendarResult = await client.query(
        `SELECT exception_id AS "exceptionId",exception_type AS type,dismissal_time AS "dismissalTime",updated_at AS "appliedAt"
         FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date`,
        [req.auth.schoolId,event.schoolDate]);
      const calendarException = calendarResult.rows[0];
      // Preserve scans captured offline before an administrator added or changed this exception.
      const exceptionAppliedBeforeEvent = calendarException && new Date(event.occurredAt) >= new Date(calendarException.appliedAt);
      if (exceptionAppliedBeforeEvent && calendarException?.type === 'CLOSED') {
        results.push({eventId:event.eventId,status:'REJECTED',reason:'School is marked closed on this date.'});
        continue;
      }
      // Dismissal time limits new check-ins, not time-outs. Learners and staff must still be able to leave after dismissal.
      if (exceptionAppliedBeforeEvent && calendarException?.type === 'SHORTENED_DAY' && calendarException.dismissalTime && event.eventType === 'TIME_IN') {
        const eventClock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(event.occurredAt));
        if (eventClock > String(calendarException.dismissalTime).slice(0,5)) {
          results.push({eventId:event.eventId,status:'REJECTED',reason:'Attendance time is after the scheduled dismissal time for this shortened day.'});
          continue;
        }
      }
      if (exceptionAppliedBeforeEvent && calendarException && ['OPEN','SPECIAL_CLASS'].includes(calendarException.type) && event.attendanceScope === 'CLASS') {
        const allowedSchedule = await client.query(
          `SELECT 1 FROM school_calendar_exception_periods ep
           JOIN class_periods p ON p.school_id=ep.school_id AND p.period_id=ep.period_id
           WHERE ep.school_id=$1 AND ep.exception_id=$2 AND ep.period_id=$3
             AND p.active=TRUE
             AND (p.effective_from IS NULL OR p.effective_from<=$4::date)
             AND (p.effective_to IS NULL OR p.effective_to>=$4::date)`,
          [req.auth.schoolId,calendarException.exceptionId,event.periodId,event.schoolDate]);
        if (!allowedSchedule.rowCount) {
          results.push({eventId:event.eventId,status:'REJECTED',reason:'This class schedule was not selected to operate on this special calendar date.'});
          continue;
        }
      }
      // Current enrollment is authoritative for class membership. The legacy
      // students.grade_level/section fields may be stale after a school-year move.
      const student = await client.query(
        `SELECT s.student_id, s.full_name, s.parent_mobile,
                COALESCE(active_enrollment.grade_level, s.grade_level) AS grade_level,
                COALESCE(active_enrollment.section, s.section) AS section,
                s.photo_path
         FROM students s
         LEFT JOIN LATERAL (
           SELECT en.grade_level, en.section
           FROM student_enrollments en
           JOIN school_years sy
             ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
           WHERE en.school_id=s.school_id AND en.student_id=s.student_id
             AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
           ORDER BY en.created_at DESC
           LIMIT 1
         ) active_enrollment ON TRUE
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE`,
        [req.auth.schoolId, event.studentId]
      );
      if (!student.rowCount) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Unknown or inactive student in this school.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER' &&
          (!student.rows[0].photo_path || event.metadata?.photoVerified !== true)) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'A registered student photo and explicit photo-match confirmation are required for Gate Keeper attendance.' });
        continue;
      }

      let period = null;
      let late = false;
      if (exceptionAppliedBeforeEvent && calendarException && ['OPEN','SPECIAL_CLASS'].includes(calendarException.type) && event.attendanceScope === 'ADVISORY') {
        const allowedAdvisory = await client.query(
          `SELECT 1 FROM school_calendar_exception_periods ep
           JOIN class_periods p ON p.school_id=ep.school_id AND p.period_id=ep.period_id
           WHERE ep.school_id=$1 AND ep.exception_id=$2 AND p.grade_level=$3
             AND (p.section IS NULL OR p.section=$4) AND p.active=TRUE
             AND (p.effective_from IS NULL OR p.effective_from<=$5::date)
             AND (p.effective_to IS NULL OR p.effective_to>=$5::date) LIMIT 1`,
          [req.auth.schoolId,calendarException.exceptionId,student.rows[0].grade_level,student.rows[0].section,event.schoolDate]);
        if (!allowedAdvisory.rowCount) {
          results.push({eventId:event.eventId,status:'REJECTED',reason:'No selected special-day schedule matches this advisory section.'});
          continue;
        }
      }
      if (event.attendanceScope === 'CLASS') {
        const periodResult = await client.query(
          `SELECT * FROM class_periods
           WHERE school_id=$1 AND period_id=$2 AND active=TRUE`,
          [req.auth.schoolId, event.periodId]
        );
        if (!periodResult.rowCount) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Unknown class period in this school.' });
          continue;
        }
        period = { ...periodResult.rows[0] };
        const adjusted = await client.query(
          'SELECT adjustment_type,subject_id,start_time,end_time,classroom,updated_at ' +
          'FROM schedule_day_adjustments WHERE school_id=$1 AND period_id=$2 AND school_date=$3::date',
          [req.auth.schoolId,event.periodId,event.schoolDate]
        );
        const dateChange=adjusted.rows[0];
        if(dateChange && new Date(event.occurredAt)>=new Date(dateChange.updated_at)) {
          if(dateChange.adjustment_type==='CANCEL') {
            results.push({eventId:event.eventId,status:'REJECTED',reason:'This class was cancelled for the selected date.'});
            continue;
          }
          if(dateChange.start_time)period.start_time=dateChange.start_time;
          if(dateChange.end_time)period.end_time=dateChange.end_time;
          if(dateChange.classroom!==null)period.classroom=dateChange.classroom;
          if(dateChange.subject_id){
            const subjectChange=await client.query(
              'SELECT subject_name FROM school_subjects WHERE school_id=$1 AND subject_id=$2',
              [req.auth.schoolId,dateChange.subject_id]);
            if(subjectChange.rowCount)period.subject_name=subjectChange.rows[0].subject_name;
          }
        }
        if (period.grade_level !== student.rows[0].grade_level ||
            (period.section && period.section !== student.rows[0].section)) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Student is not enrolled in this period section.' });
          continue;
        }
        if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' &&
            !(await isTeacherAssigned(client, req.auth.schoolId, req.auth.userId, event.periodId, event.schoolDate, event.occurredAt))) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teacher is not assigned to this class period.' });
          continue;
        }
        late = event.eventType === 'TIME_IN' && isLateForPeriod(event.occurredAt, period);
      } else if (event.attendanceScope === 'ADVISORY') {
        const adviser = await client.query(
          `SELECT 1 FROM class_adviser_assignments
           WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4 LIMIT 1`,
          [req.auth.schoolId, req.auth.userId, student.rows[0].grade_level, student.rows[0].section]
        );
        if (req.auth.type !== 'SCHOOL_USER' || req.auth.role !== 'TEACHER' || !adviser.rowCount) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teacher is not the assigned Class Adviser for this learner section.' });
          continue;
        }
      } else if (event.eventType === 'TIME_IN') {
        const setting = await client.query(
          `SELECT setting_value FROM school_settings
           WHERE school_id=$1 AND setting_key='school_start_time'`,
          [req.auth.schoolId]
        );
        if (setting.rowCount && setting.rows[0].setting_value.time) {
          late = isLateForPeriod(event.occurredAt, {
            start_time: setting.rows[0].setting_value.time,
            grace_minutes: setting.rows[0].setting_value.graceMinutes || 0
          });        }
      }

      const duplicate = await client.query(
        `SELECT event_id FROM attendance_events
         WHERE school_id=$1 AND student_id=$2 AND school_date=$3 AND attendance_scope=$4
           AND COALESCE(period_id::text,'SCHOOL')=COALESCE($5::text,'SCHOOL')
           AND event_type=$6 AND sync_status='ACCEPTED'
         LIMIT 1`,
        [req.auth.schoolId, event.studentId, event.schoolDate, event.attendanceScope, event.periodId || null, event.eventType]
      );
      const rawDeviceId = req.auth.type === 'DEVICE'
        ? req.auth.deviceId
        : (validText(event.deviceId) ? event.deviceId.trim() : `USER-${req.auth.userId}`);
      const actorUserId = req.auth.type === 'SCHOOL_USER' ? req.auth.userId : null;
      const safeMetadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata : {};

      if (duplicate.rowCount) {
        await client.query(
          `INSERT INTO attendance_events
           (event_id, school_id, device_id, student_id, attendance_scope, period_id, event_type,
            occurred_at_device, school_date, sync_status, duplicate_of, metadata, recorded_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'DUPLICATE',$10,$11,$12)
           ON CONFLICT(event_id) DO NOTHING`,
          [event.eventId, req.auth.schoolId, rawDeviceId, event.studentId, event.attendanceScope,
           event.periodId || null, event.eventType, event.occurredAt, event.schoolDate,
           duplicate.rows[0].event_id, safeMetadata, actorUserId]
        );
        results.push({ eventId: event.eventId, status: 'DUPLICATE', duplicateOf: duplicate.rows[0].event_id });
        continue;
      }

      await client.query(
        `INSERT INTO attendance_events
         (event_id, school_id, device_id, student_id, attendance_scope, period_id, event_type,
          occurred_at_device, school_date, late, metadata, recorded_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [event.eventId, req.auth.schoolId, rawDeviceId, event.studentId, event.attendanceScope,
         event.periodId || null, event.eventType, event.occurredAt, event.schoolDate,
         late, safeMetadata, actorUserId]
      );

      const cloudPayload = {
        eventId: event.eventId,
        studentId: event.studentId,
        eventType: event.eventType,
        attendanceScope: event.attendanceScope,
        occurredAt: event.occurredAt,
        schoolDate: event.schoolDate,
        late,
        metadata: safeMetadata,
        student: {
          studentId: event.studentId,
          fullName: student.rows[0].full_name,
          gradeLevel: student.rows[0].grade_level,
          section: student.rows[0].section
        },
        period: period ? {
          periodName: period.period_name,
          subjectName: period.subject_name,
          startTime: String(period.start_time).slice(0, 5),
          endTime: String(period.end_time).slice(0, 5),
          graceMinutes: period.grace_minutes
        } : null
      };
      await client.query(
        `INSERT INTO school_cloud_sync_outbox(school_id,event_id,payload)
         SELECT $1,$2,$3::jsonb WHERE EXISTS (
           SELECT 1 FROM school_cloud_sync_settings WHERE school_id=$1 AND enabled=TRUE
         ) ON CONFLICT(school_id,event_id) DO NOTHING`,
        [req.auth.schoolId, event.eventId, JSON.stringify(cloudPayload)]
      );

      // SMS is queued transactionally by attendance_sms_enqueue for every attendance entry path.
      results.push({ eventId: event.eventId, status: 'ACCEPTED', late, ...(automaticGate?{eventType:event.eventType,occurredAt:event.occurredAt}: {}) });
    }
    await client.query('COMMIT');
    return res.json({ results, serverTime: new Date().toISOString() });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance sync failed:', err.message);
    return res.status(500).json({ error: 'Attendance synchronization failed.' });
  } finally {
    client.release();
  }
});

// School dashboard: school admins see their school; teachers see only assigned class data.
app.get('/api/admin/dashboard', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  const isSchoolWideViewer = ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(req.auth.role);
  try {
    const studentSql = isSchoolWideViewer
      ? `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active
         FROM students WHERE school_id=$1`
      : `SELECT COUNT(DISTINCT s.student_id)::int AS total,
                COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active
         FROM students s WHERE s.school_id=$1 AND s.active=TRUE AND ${TEACHER_STUDENT_SCOPE}`;
    const attendanceSql = isSchoolWideViewer
      ? `SELECT
           COUNT(*) FILTER (WHERE attendance_scope='SCHOOL' AND event_type='TIME_IN' AND sync_status='ACCEPTED')::int AS school_arrivals,
           COUNT(*) FILTER (WHERE attendance_scope='SCHOOL' AND event_type='TIME_IN' AND late AND sync_status='ACCEPTED')::int AS late_arrivals,
           COUNT(*) FILTER (WHERE attendance_scope='CLASS' AND event_type='TIME_IN' AND sync_status='ACCEPTED')::int AS class_checkins
         FROM attendance_events
         WHERE school_id=$1 AND school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`
      : `SELECT
           0::int AS school_arrivals, 0::int AS late_arrivals,
           COUNT(*) FILTER (WHERE e.attendance_scope='CLASS' AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED')::int AS class_checkins
         FROM attendance_events e
         WHERE e.school_id=$1 AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
           AND (
             EXISTS (SELECT 1 FROM teacher_period_assignments a
                     WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$2)
             OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                        WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                          AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
                          AND e.school_date BETWEEN ts.start_date AND ts.end_date)
           )`;
    const params = isSchoolWideViewer ? [req.auth.schoolId] : [req.auth.schoolId, req.auth.userId];
    const smsSql = isSchoolWideViewer
      ? `SELECT o.status, COUNT(*)::int AS count FROM sms_outbox o
         JOIN attendance_events e ON e.event_id=o.event_id AND e.school_id=$1 GROUP BY o.status`
      : `SELECT o.status, COUNT(*)::int AS count FROM sms_outbox o
         JOIN attendance_events e ON e.event_id=o.event_id AND e.school_id=$1
         WHERE (
           EXISTS (SELECT 1 FROM teacher_period_assignments a
                   WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$2)
           OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                      WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                        AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
                        AND e.school_date BETWEEN ts.start_date AND ts.end_date)
         )
         GROUP BY o.status`;
    const devicesSql = isSchoolWideViewer
      ? `SELECT COUNT(*)::int AS registered,
                COUNT(*) FILTER (WHERE active)::int AS active
         FROM attendance_devices WHERE school_id=$1`
      : `SELECT 0::int AS registered, 0::int AS active`;
    const recentSql = isSchoolWideViewer
      ? `SELECT e.event_id AS "eventId", e.student_id AS "studentId", s.full_name AS "fullName",
                e.attendance_scope AS scope, e.event_type AS "eventType", e.late,
                e.occurred_at_device AS "occurredAt", e.sync_status AS "syncStatus"
         FROM attendance_events e JOIN students s
           ON s.school_id=e.school_id AND s.student_id=e.student_id
         WHERE e.school_id=$1
         ORDER BY e.received_at_server DESC LIMIT 20`
      : teacherRecentClassAttendanceSql;

    const learnerSummarySql = isSchoolWideViewer
      ? `SELECT
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active_learners,
           COUNT(DISTINCT e.student_id) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_present_today,
           COUNT(DISTINCT (e.student_id, e.school_date)) FILTER (
             WHERE e.school_date >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.school_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_learner_days_month,
           COUNT(*) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS subject_checkins_today
         FROM students s
         LEFT JOIN attendance_events e ON e.school_id=s.school_id AND e.student_id=s.student_id
         WHERE s.school_id=$1`
      : `SELECT
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active_learners,
           COUNT(DISTINCT e.student_id) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_present_today,
           COUNT(DISTINCT (e.student_id, e.school_date)) FILTER (
             WHERE e.school_date >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.school_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_learner_days_month,
           COUNT(*) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS subject_checkins_today
         FROM students s
         LEFT JOIN attendance_events e ON e.school_id=s.school_id AND e.student_id=s.student_id
         WHERE s.school_id=$1 AND s.active=TRUE AND ${TEACHER_STUDENT_SCOPE}`;

    const [students, attendance, sms, devices, recent, learnerSummary] = await Promise.all([
      pool.query(studentSql, params),
      pool.query(attendanceSql, params),
      pool.query(smsSql, params),
      pool.query(devicesSql, isSchoolWideViewer ? params : []),
      pool.query(recentSql, params),
      pool.query(learnerSummarySql, params)
    ]);
    const learner = learnerSummary.rows[0] || {};
    const activeLearners = Number(learner.active_learners || 0);
    const confirmedPresent = Number(learner.confirmed_present_today || 0);
    return res.json({
      students: students.rows[0],
      today: attendance.rows[0],
      learnerAttendance: {
        activeLearners,
        confirmedPresentToday: confirmedPresent,
        pendingConfirmationToday: Math.max(0, activeLearners - confirmedPresent),
        confirmedLearnerDaysMonth: Number(learner.confirmed_learner_days_month || 0),
        subjectCheckinsToday: Number(learner.subject_checkins_today || 0),
        absenceFinalizationAvailable: false
      },
      sms: Object.fromEntries(sms.rows.map(row => [row.status, row.count])),
      devices: devices.rows[0],
      recent: recent.rows,
      school: { schoolId: req.auth.schoolId, schoolCode: req.auth.schoolCode, schoolName: req.auth.schoolName },
      viewerRole: req.auth.role
    });
  } catch (err) {
    console.error('School dashboard failed:', err.message);
    return res.status(500).json({ error: 'Dashboard data unavailable.' });
  }
});

app.get('/vendor/html5-qrcode.min.js', (_req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'))
);
// Basic liveness endpoint for deployment and diagnostics. No school data is exposed.
app.get('/api/health', databaseReadiness);
registerStartupReadinessRoute(app, pool, { migrationReadOnly });

// Serve one canonical login URL for desktop, mobile browsers, and installed PWAs.
// Preserve only the supported account-mode option; never copy credentials from a URL.
function canonicalLoginUrl(req) {
  return '/portal-login.html' + (req.query.mode === 'platform' ? '?mode=platform' : '');
}
app.get('/', (req, res) => {
  res.redirect(302, canonicalLoginUrl(req));
});

// Retire the legacy Attendance Desk landing page
app.get('/index.html', (req, res) => {
  res.redirect(302, canonicalLoginUrl(req));
});

app.get('/staff-lunch-checkin.html',(_req,res)=>{
  res.set('Cache-Control','no-store, private');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Content-Type-Options','nosniff');
  return res.sendFile(path.join(__dirname,'public','staff-lunch-checkin.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

const port = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);


async function processDueTeacherReturns() {
  try {
    const result = await pool.query(
      `WITH due AS (
         UPDATE school_users
         SET active=TRUE, teacher_status='ACTIVE', leave_type=NULL,
             leave_start_date=NULL, expected_return_date=NULL,
             updated_at=NOW()
         WHERE role='TEACHER' AND teacher_status='ON_LEAVE'
           AND leave_auto_reactivate=TRUE
           AND expected_return_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
         RETURNING school_id, user_id, username
       ), cancelled_covers AS (
         UPDATE teacher_period_substitutions ts
         SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
         FROM due d
         WHERE ts.school_id=d.school_id
           AND ts.original_teacher_user_id=d.user_id
           AND ts.status='ACTIVE'
         RETURNING ts.school_id, ts.substitution_id, ts.original_teacher_user_id,
                   ts.substitute_teacher_user_id, ts.period_id
       ), teacher_audit AS (
         INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         SELECT school_id, 'SYSTEM', NULL, 'SYSTEM_AUTO_RETURN_TEACHER',
                'school_user', user_id::text,
                jsonb_build_object('username', username, 'returnedOn', (NOW() AT TIME ZONE 'Asia/Manila')::date)
         FROM due
         RETURNING entity_id
       ), cover_audit AS (
         INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         SELECT school_id, 'SYSTEM', NULL, 'SYSTEM_END_SUBSTITUTE_ON_TEACHER_RETURN',
                'teacher_period_substitution', substitution_id::text,
                jsonb_build_object('originalTeacherUserId', original_teacher_user_id,
                                   'substituteTeacherUserId', substitute_teacher_user_id,
                                   'periodId', period_id,
                                   'reason', 'Original teacher automatically returned')
         FROM cancelled_covers
         RETURNING entity_id
       )
       SELECT (SELECT COUNT(*) FROM due)::int AS returned_count,
              (SELECT COUNT(*) FROM cancelled_covers)::int AS cancelled_cover_count`
    );
    const returned = result.rows[0]?.returned_count || 0;
    const cancelled = result.rows[0]?.cancelled_cover_count || 0;
    if (returned) console.log(`Automatically returned ${returned} teacher account(s) from leave.`);
    if (cancelled) console.log(`Automatically ended ${cancelled} temporary substitute cover(s).`);
  } catch (err) {
    console.error('Automatic teacher return check failed:', err.code || err.name || 'UNKNOWN');
  }
}

async function start() {
  console.log('Checking database migrations...');
  const migrationResult = await runMigrations(pool);
  console.log(`Database migrations ready: ${migrationResult.applied.length} applied, ${migrationResult.total} total.`);
  // Report only a coarse provider classification; no hostnames, secrets or
  // personal record values. Helps confirm migration cutover without creating
  // any public diagnostic endpoint or changing application data.
  try {
    const target = await pool.query('SELECT current_database() AS db');
    const dbName = target.rows?.[0]?.db;
    const provider = dbName === 'postgres' ? 'supabase_candidate'
      : dbName === 'student_tracker_bpv7' ? 'render_source' : 'unrecognized';
    console.log('[Production DB identity] ' + provider);
  } catch {
    console.warn('[Production DB identity] unavailable');
  }

  console.log('[Database] Primary=' + (supabasePrimary ? 'supabase' : 'render') +
    ' maintenance=' + (migrationReadOnly ? 'read_only' : 'off'));
  // A maintenance instance must not run autonomous attendance or cleanup
  // workers or write QR tokens during the database snapshot window.
  if (migrationReadOnly) {
    app.listen(port, '0.0.0.0', () =>
      console.log('Attendance API in secure read-only cutover maintenance mode'));
    return;
  }
  // Safe read-only connectivity probe; never switches or writes to the target.
  void runSupabasePreflight().catch(() => console.warn('[Supabase preflight] probe_unavailable'));

  // Remove recovery snapshots 30 days after school deletion, including their
  // child rows via ON DELETE CASCADE. Run at startup and hourly thereafter.
  const { purgeExpiredSchoolDeletionBackups } = require('./platform-school-deletion-routes');
  const purgeSchoolBackups = singleFlight(() => purgeExpiredSchoolDeletionBackups(pool)
    .catch(error => console.error('School backup retention worker failed:', error.code || error.name || 'UNKNOWN')));
  await purgeSchoolBackups();
  const backupRetentionTimer = setInterval(purgeSchoolBackups, 60 * 60 * 1000);
  backupRetentionTimer.unref();
  const checkTeacherReturns = singleFlight(processDueTeacherReturns);
  await checkTeacherReturns();
  const teacherReturnTimer = setInterval(() => { void checkTeacherReturns(); }, 60 * 1000);
  teacherReturnTimer.unref();
  // Ensure QR credentials exist before accepting requests; this is a harmless, idempotent compatibility migration.
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_token UUID');
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_path TEXT');
  await fsp.mkdir(STUDENT_PHOTO_ROOT, { recursive: true });
  await pool.query('UPDATE students SET qr_token=gen_random_uuid() WHERE qr_token IS NULL');
  app.listen(port, '0.0.0.0', () => console.log(`Attendance API listening on ${port} (roles-sf2-workflow-responsive-2026-11-11)`));
  smsWorker = startSmsWorker(pool);
  // Catch up on unacknowledged cloud events immediately after a sleeping Free
  // instance resumes. Existing outbox idempotency prevents duplicate dispatch.
  const syncOnce = singleFlight(() => processCloudSyncOutbox(pool)
    .catch(err => console.error('Cloud sync worker failed:', err.code || err.name || 'UNKNOWN')));
  void syncOnce();
  const cloudSyncTimer = setInterval(() => { void syncOnce(); }, 15 * 1000);
  cloudSyncTimer.unref();
  const certPath = path.join(__dirname, 'localhost+ip.pem');
  const keyPath = path.join(__dirname, 'localhost+ip-key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
      .listen(httpsPort, '0.0.0.0', () => console.log(`Secure HTTPS server listening on ${httpsPort}`));
  } else {
    console.warn('HTTPS certificates not found; HTTPS listener not started. Use HTTPS for non-local network deployments.');
  }
}

start().catch(err => {
  console.error('Server startup failed:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => { if (smsWorker) await smsWorker.stop(); await pool.end(); process.exit(0); });
process.on('SIGTERM', async () => { if (smsWorker) await smsWorker.stop(); await pool.end(); process.exit(0); });

