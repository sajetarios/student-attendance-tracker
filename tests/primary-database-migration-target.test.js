'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolveMigrationPoolOptions}=require('../scripts/db-migrate');
test('manual migration refuses silent fallback to old Render database when Supabase is selected',async()=>{
 await assert.rejects(resolveMigrationPoolOptions({ATTENDIGO_PRIMARY_DATABASE:'supabase',DATABASE_URL:'postgres://stale/db'}),/SUPABASE_DATABASE_URL/);
 await assert.rejects(resolveMigrationPoolOptions({ATTENDIGO_PRIMARY_DATABASE:'unknown'}),/Unknown/);
});
test('Render migration URL is used only in explicitly render mode',async()=>{
 const expected='postgres://testuser:testpassword@localhost:5432/school_attendance_test';
 assert.deepEqual(await resolveMigrationPoolOptions({ATTENDIGO_PRIMARY_DATABASE:'render',DATABASE_URL:expected}),{connectionString:expected});
});
test('SF2 official submission content is persisted with transaction, not ephemeral local path',()=>{
 const sql=fs.readFileSync('migrations/072_durable_sf2_submission_files.sql','utf8');
 const code=fs.readFileSync('sf2-routes.js','utf8');
 assert.match(sql,/file_bytes BYTEA/);
 assert.match(sql,/file_sha256 TEXT/);
 const submit=code.slice(code.indexOf("app.post('/api/sf2/submissions'"),code.indexOf("app.get('/api/sf2/submissions'",code.indexOf("app.post('/api/sf2/submissions'")));
 assert.match(submit,/file_bytes,file_sha256,file_size/);
 assert.doesNotMatch(submit,/fs\.writeFile|fs\.mkdir|filePath = path\.relative/);
 assert.match(code,/crypto\.createHash\('sha256'\)/);
 assert.match(code,/res\.end\(fileBytes\)/);
});
