'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Admin direct account actions settle the corresponding pending teacher request in the same transaction',()=>{
 const route=source('student-portal-account-routes.js');
 assert.match(route,/async function settleMatchingRequests\(db, auth, studentId, action\)/);
 assert.match(route,/SET status='APPROVED', reviewed_by_user_id=\$3, reviewed_at=NOW\(\)/);
 assert.match(route,/WHERE school_id=\$1 AND student_id=\$2 AND status='PENDING' AND request_type=\$4/);
 assert.match(route,/await provision\(db,req\.auth,studentId,action\); await settleMatchingRequests\(db,req\.auth,studentId,action\)/);
 assert.match(route,/await settleMatchingRequests\(db,req\.auth,id,'CREATE'\)/);
 assert.match(route,/await settleMatchingRequests\(db,req\.auth,studentId,'ACTIVATE'\)/);
 assert.match(route,/SCHOOL_ADMIN_FULFILLED_STUDENT_PORTAL_REQUEST/);
});

test('Historical pending reset requests reconcile only against audited admin actions occurring after request',()=>{
 const migration=source('migrations/032_reconcile_student_account_requests.sql');
 assert.match(migration,/r\.status='PENDING'/);
 assert.match(migration,/a\.created_at >= r\.created_at/);
 assert.match(migration,/a\.details->>'studentId'=r\.student_id/);
 assert.match(migration,/SCHOOL_ADMIN_RESET_STUDENT_PORTAL_LOGIN/);
 assert.match(migration,/SCHOOL_ADMIN_RESET_STUDENT_PASSWORD/);
 assert.match(migration,/SET status='APPROVED'/);
 assert.doesNotMatch(migration,/password_hash|temporaryPassword|DELETE\s+FROM\s+students/i);
 assert.match(source('scripts/migrate.js'),/032_reconcile_student_account_requests\.sql/);
});

test('School Admin gets request bell with protected student and guardian counts',()=>{
 const html=source('public/portal.html');
 const script=source('public/admin-request-notifications.js');
 assert.match(html,/id="adminNotificationBell"/);
 assert.match(html,/id="adminStudentRequestsShortcut"/);
 assert.match(html,/id="adminGuardianRequestsShortcut"/);
 assert.match(html,/id="adminNotificationCount"/);
 assert.match(script,/getUser\(\)\?\.role==='SCHOOL_ADMIN'/);
 assert.match(script,/api\('\/api\/student-portal\/requests'\)/);
 assert.match(script,/api\('\/api\/guardians\/requests'\)/);
 assert.match(script,/filter\(r=>r\.status==='PENDING'\)/);
 assert.match(script,/window\.AttendigoGuardian\.openApprovals\(\)/);
});

test('Guardian approvals appear in People Management, not as a floating dashboard button',()=>{
 const html=source('public/portal.html');
 const guardian=source('public/guardian-ui.js');
 assert.match(html,/id="guardianApprovalsNav"/);
 assert.match(html,/id="guardianNavBadge"/);
 assert.match(guardian,/guardianApprovalsNav/);
 assert.match(guardian,/openApprovals\(\)/);
 assert.doesNotMatch(guardian,/guardianApprovalStandalone/);
});

test('One-time admin credential slips print without exposing passwords to teachers',()=>{
 const html=source('public/portal.html');
 const script=source('public/student-portal-accounts.js');
 const css=source('public/student-portal-accounts.css');
 assert.match(html,/id="sapPrintSecrets"/);
 assert.match(script,/if\(!isAdmin\(\) \|\| !credentials\.length\)return/);
 assert.match(script,/record\.temporaryPassword/);
 assert.match(script,/window\.print\(\)/);
 assert.match(script,/document\.dispatchEvent\(new CustomEvent\('attendigo:requests-changed'\)\)/);
 assert.match(css,/@media print/);
 assert.match(css,/sap-print-slip/);
});
