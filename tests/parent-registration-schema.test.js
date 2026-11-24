'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('migrations/082_parent_department_optional.sql','utf8');
const registry=fs.readFileSync('scripts/migrate.js','utf8');
const parent=fs.readFileSync('parent-routes.js','utf8');
test('parent-only department exception preserves staff department requirement',()=>{
 assert.match(migration,/ALTER TABLE school_users ALTER COLUMN department_id DROP NOT NULL/i);
 assert.match(migration,/CHECK\s*\(\s*role\s*=\s*'PARENT'\s+OR\s+department_id\s+IS NOT NULL\s*\)/i);
 assert.doesNotMatch(migration,/DROP (?:TABLE|SCHEMA)|DELETE FROM|TRUNCATE/i);
 assert.match(registry,/'082_parent_department_optional\.sql'/);
});
test('parent registrations remain pending until school admin approval',()=>{
 assert.match(parent,/app\.post\('\/api\/parents\/register'/);
 assert.match(parent,/VALUES\(\$1,\$2,\$3,\$4,'PARENT',FALSE,\$5\)/);
 assert.match(parent,/VALUES\(\$1,\$2,\$3,\$4,'PENDING'\)/);
 assert.match(parent,/parent_student_links/);
 assert.match(parent,/status='APPROVED'/);
 assert.match(parent,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
});
