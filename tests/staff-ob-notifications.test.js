'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('migrations/054_ob_notification_lifecycle.sql','utf8');
const migration=fs.readFileSync('scripts/migrate.js','utf8');
const ui=fs.readFileSync('public/staff-ob-ui.js','utf8');
const bell=fs.readFileSync('public/universal-notifications.js','utf8');
const portal=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');

test('OB notification migration is registered and transactional',()=>{
 assert.match(migration,/054_ob_notification_lifecycle.sql/);
 assert.match(sql,/AFTER INSERT OR UPDATE OF status ON staff_official_business_requests/);
 assert.match(sql,/NEW\.status IS NOT DISTINCT FROM OLD\.status/);
 assert.match(sql,/PERFORM attendigo_notify/);
});
test('Department Head inbox follows school and department authorization',()=>{
 assert.match(sql,/school_id=NEW\.school_id AND department_id=NEW\.department_id/);
 assert.match(sql,/role='DEPARTMENT_HEAD' AND active=TRUE/);
 assert.match(sql,/user_id<>NEW\.staff_user_id/);
 assert.match(sql,/':pending-head'/);
});
test('School Admin is notified after recommendation, staff on final decision',()=>{
 assert.match(sql,/NEW\.status='PENDING_ADMIN'/);
 assert.match(sql,/role='SCHOOL_ADMIN' AND active=TRUE/);
 assert.match(sql,/':pending-admin'/);
 assert.match(sql,/NEW\.status IN \('APPROVED','REJECTED','CANCELLED'\)/);
 assert.match(sql,/NEW\.staff_user_id/);
});
test('Pending and final historical requests are backfilled without duplicates',()=>{
 assert.match(sql,/ob\.status='PENDING_HEAD'/);
 assert.match(sql,/ob\.status='PENDING_ADMIN'/);
 assert.match(sql,/ob\.status IN \('APPROVED','REJECTED','CANCELLED'\)/);
 assert.match(sql,/ON CONFLICT\(recipient_kind,recipient_id,event_key\) DO NOTHING/);
});
test('OB notifications open the correct module and refresh after decisions',()=>{
 assert.match(sql,/\/portal\.html#officialBusiness/);
 assert.match(bell,/document\.querySelector\('\[data-view="' \+ view \+ '"\]'\)/);
 assert.match(ui,/document\.dispatchEvent\(new Event\('attendigo:requests-changed'\)\)/);
 assert.match(portal,/staff-ob-ui\.js\?v=4/);
 assert.match(sw,/staff-ob-ui\.js\?v=4/);
});
