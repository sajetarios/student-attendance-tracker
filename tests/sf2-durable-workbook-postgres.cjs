'use strict';
// Disposable PostgreSQL acceptance: persist a real official-style XLSX, read it
// back with SHA-256 validation and assert cross-school scope.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const ExcelJS=require('exceljs');
const {Pool}=require('pg');
async function main(){
 const url=process.env.DATABASE_URL||'';
 if(!/\/school_attendance_test$/.test(new URL(url).pathname))
  throw Error('Refusing SF2 acceptance test outside disposable school_attendance_test');
 const pool=new Pool({connectionString:url});
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const suffix=crypto.randomBytes(7).toString('hex');
  const school=(await client.query(
   "INSERT INTO schools(school_code,school_name) VALUES($1,'SF2 storage synthetic school') RETURNING school_id",
   ['SF2BACK_'+suffix])).rows[0].school_id;
  const department=(await client.query(
   "INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'ADM','Synthetic department') RETURNING department_id",
   [school])).rows[0].department_id;
  const teacher=(await client.query(
   "INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations) "+
   "VALUES($1,$2,$3,'Synthetic Adviser','synthetic-no-login','TEACHER',ARRAY['CLASS_ADVISER']::text[]) RETURNING user_id",
   [school,department,'sf2-adviser-'+suffix])).rows[0].user_id;
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet('Official SF2').getCell('A1').value='Synthetic attendance test only';
  const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  const saved=await client.query(
   "INSERT INTO sf2_submissions (school_id,reporting_month,grade_level,section,revision,status,is_current,"+
   "file_name,file_path,submitted_by_user_id,summary,file_bytes,file_sha256,file_size) "+
   "VALUES($1,'2026-11-01'::date,'Grade 8','Synthetic',1,'SUBMITTED',TRUE,"+
   "'test.xlsx','db:sf2',$2,'{}'::jsonb,$3,$4,$5) RETURNING submission_id",
   [school,teacher,bytes,checksum,bytes.length]);
  assert.equal(saved.rowCount,1);
  const result=await client.query(
   'SELECT file_bytes AS bytes,file_size AS size,file_sha256 AS sha FROM sf2_submissions '+
   'WHERE school_id=$1 AND submission_id=$2 AND is_current=TRUE',
   [school,saved.rows[0].submission_id]);
  assert.equal(result.rowCount,1);
  assert.ok(Buffer.isBuffer(result.rows[0].bytes));
  assert.deepEqual(result.rows[0].bytes,bytes);
  assert.equal(result.rows[0].size,bytes.length);
  assert.equal(result.rows[0].sha,checksum);
  const parsed=new ExcelJS.Workbook();
  await parsed.xlsx.load(result.rows[0].bytes);
  assert.equal(parsed.worksheets[0].getCell('A1').value,'Synthetic attendance test only');
  const wrongSchool=await client.query(
   'SELECT 1 FROM sf2_submissions WHERE school_id=$1 AND submission_id=$2',
   [crypto.randomUUID(),saved.rows[0].submission_id]);
  assert.equal(wrongSchool.rowCount,0);
  console.log('SF2 durable XLSX storage, checksum and tenant isolation passed.');
 } finally {
  await client.query('ROLLBACK').catch(()=>{});
  client.release();
  await pool.end();
 }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
