'use strict';
// Run ONLY against an isolated disposable restore_test DB after decrypt+pg_restore.
// Ensures the backup contains the actual committed SF2 workbook, not just tables.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

async function main() {
  const url = new URL(process.env.ATTENDIGO_RESTORE_TEST_DATABASE_URL || '');
  if (process.env.CI !== 'true' || url.pathname !== '/attendigo_restore_test' ||
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw Error('Refusing SF2 backup verification outside isolated local CI restore_test database.');
  }
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    const result = await pool.query(
      'SELECT sub.file_bytes AS bytes, sub.file_size AS size, sub.file_sha256 AS sha ' +
      'FROM sf2_submissions sub JOIN schools s ON s.school_id=sub.school_id ' +
      "WHERE s.school_name='SF2 reconnect synthetic school' AND sub.file_path='db:sf2' " +
      "AND sub.is_current=TRUE"
    );
    assert.equal(result.rowCount, 1, 'One fictional committed SF2 workbook must survive isolated restore');
    const { bytes, size, sha } = result.rows[0];
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(size > 0 && size <= 8 * 1024 * 1024);
    assert.equal(size, bytes.length);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    assert.equal(workbook.worksheets[0].getCell('A1').value, 'Synthetic attendance test only');
    console.log('Encrypted database backup restored real synthetic SF2 XLSX with valid SHA-256.');
  } finally {
    await pool.end();
  }
}
main().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
