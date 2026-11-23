'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const migrationName='076_deped_sick_leave_credit_scheme.sql';
test('DepEd sick-leave migration is explicitly registered and ordered after 075',()=>{
 const registry=fs.readFileSync(path.join(root,'scripts/migrate.js'),'utf8');
 assert.match(registry,/\'075_department_optional_for_leave_applicant\.sql\',\s*\'076_deped_sick_leave_credit_scheme\.sql\'/);
 assert.ok(fs.existsSync(path.join(root,'migrations',migrationName)));
});
test('leave scheme migration is additive, tenant-scoped and cannot grant direct API access',()=>{
 const ddl=fs.readFileSync(path.join(root,'migrations',migrationName),'utf8');
 assert.match(ddl,/CREATE TABLE IF NOT EXISTS staff_leave_credit_schemes/);
 assert.match(ddl,/PRIMARY KEY\(school_id,staff_user_id\)/);
 assert.match(ddl,/ALTER TABLE staff_leave_credit_schemes ENABLE ROW LEVEL SECURITY/);
 for(const role of ['anon','authenticated']){
  assert.ok(ddl.includes("IF EXISTS (SELECT FROM pg_roles WHERE rolname = '"+role+"') THEN"));
  assert.ok(ddl.includes('REVOKE ALL ON TABLE staff_leave_credit_schemes FROM '+role+';'));
 }
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS filing_basis/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS credit_account/);
 assert.match(ddl,/AFFIDAVIT/);
 assert.doesNotMatch(ddl,/\b(TRUNCATE|DROP TABLE|DELETE FROM|UPDATE students|UPDATE staff_attendance_events)\b/i);
});
