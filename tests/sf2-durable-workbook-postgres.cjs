'use strict';
// Disposable PostgreSQL acceptance: COMMIT a fictional official-style SF2 XLSX,
// close the writer connection, then verify bytes and tenant isolation using a
// newly opened database connection (as after a process restart).
// Never execute this test against staging or production databases.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

function ensureDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.pathname !== '/school_attendance_test' ||
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
      (process.env.CI !== 'true' &&
       process.env.ATTENDIGO_ALLOW_LOCAL_PG_PILOT_TEST !== 'true')) {
    throw Error('SF2 reconnect drill requires a confirmed disposable local school_attendance_test database.');
  }
  return url.toString();
}

async function main() {
  const connectionString = ensureDisposableDatabase();
  const suffix = crypto.randomBytes(7).toString('hex');
  const writerPool = new Pool({ connectionString, max: 1 });
  let school, submissionId, bytes, checksum, writerPid;
  const writer = await writerPool.connect();
  let committed = false;
  try {
    await writer.query('BEGIN');
    writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    school = (await writer.query(
      "INSERT INTO schools(school_code,school_name) VALUES($1,'SF2 reconnect synthetic school') RETURNING school_id",
      ['SF2RECON_' + suffix]
    )).rows[0].school_id;
    const department = (await writer.query(
      "INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'ADM','Synthetic department') RETURNING department_id",
      [school]
    )).rows[0].department_id;
    const teacher = (await writer.query(
      "INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations) " +
      "VALUES($1,$2,$3,'Synthetic Adviser','synthetic-no-login','TEACHER',ARRAY['CLASS_ADVISER']::text[]) RETURNING user_id",
      [school, department, 'sf2-reconnect-' + suffix]
    )).rows[0].user_id;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Official SF2').getCell('A1').value = 'Synthetic attendance test only';
    bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const saved = await writer.query(
      "INSERT INTO sf2_submissions (school_id,reporting_month,grade_level,section,revision,status,is_current," +
      "file_name,file_path,submitted_by_user_id,summary,file_bytes,file_sha256,file_size) " +
      "VALUES($1,'2026-11-01'::date,'Grade 8','Synthetic',1,'SUBMITTED',TRUE," +
      "'synthetic-reconnect.xlsx','db:sf2',$2,'{}'::jsonb,$3,$4,$5) RETURNING submission_id",
      [school, teacher, bytes, checksum, bytes.length]
    );
    assert.equal(saved.rowCount, 1);
    submissionId = saved.rows[0].submission_id;
    await writer.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) await writer.query('ROLLBACK').catch(() => {});
    writer.release();
    await writerPool.end();
  }

  // This second pool has no connection to the first pool: it must read
  // committed database state, not uncommitted rows in one live session.
  const readerPool = new Pool({ connectionString, max: 1 });
  try {
    const readerPid = (await readerPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.notEqual(readerPid, writerPid, 'SF2 verification must use a fresh database session');
    const result = await readerPool.query(
      'SELECT file_bytes AS bytes, file_size AS size, file_sha256 AS sha FROM sf2_submissions ' +
      'WHERE school_id=$1 AND submission_id=$2 AND is_current=TRUE',
      [school, submissionId]
    );
    assert.equal(result.rowCount, 1);
    assert.ok(Buffer.isBuffer(result.rows[0].bytes));
    assert.deepEqual(result.rows[0].bytes, bytes);
    assert.equal(result.rows[0].size, bytes.length);
    assert.equal(result.rows[0].sha, checksum);
    assert.equal(crypto.createHash('sha256').update(result.rows[0].bytes).digest('hex'), checksum);
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(result.rows[0].bytes);
    assert.equal(parsed.worksheets[0].getCell('A1').value, 'Synthetic attendance test only');
    const wrongSchool = await readerPool.query(
      'SELECT 1 FROM sf2_submissions WHERE school_id=$1 AND submission_id=$2',
      [crypto.randomUUID(), submissionId]
    );
    assert.equal(wrongSchool.rowCount, 0);
    console.log('SF2 COMMIT, independent reconnect, workbook checksum and tenant isolation passed.');
  } finally {
    // Cleanup only the fictional data created by this test. Failure is surfaced.
    try {
      await readerPool.query('DELETE FROM sf2_submissions WHERE school_id=$1 AND submission_id=$2', [school, submissionId]);
      await readerPool.query('DELETE FROM school_users WHERE school_id=$1', [school]);
      await readerPool.query('DELETE FROM school_departments WHERE school_id=$1', [school]);
      await readerPool.query('DELETE FROM schools WHERE school_id=$1', [school]);
    } finally {
      await readerPool.end();
    }
  }
}

main().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
