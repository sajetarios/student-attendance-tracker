'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { readImportRows } = require('../student-management-routes');

test('student importer reads Excel rows and normalizes sex', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['Student ID', 'LRN', 'Full Name', 'Sex', 'Grade Level', 'Section', 'Parent Name', 'Parent Mobile']);
  sheet.addRow(['G7-001', '123456789012', 'Juan Dela Cruz', 'Male', 'Grade 7', 'Section A', 'Maria Dela Cruz', '09171234567']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await readImportRows('students.xlsx', buffer.toString('base64'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentId, 'G7-001');
  assert.equal(rows[0].sex, 'MALE');
  assert.equal(rows[0].gradeLevel, 'Grade 7');
  assert.equal(rows[0].section, 'Section A');
});

test('student importer reads CSV files and preserves row numbers', async () => {
  const csv = [
    'Student ID,Full Name,Sex,Grade Level,Section',
    'G8-010,Alex Santos,Female,Grade 8,Section B'
  ].join('\n');
  const rows = await readImportRows('students.csv', Buffer.from(csv).toString('base64'));
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].sex, 'FEMALE');
  assert.equal(rows[0].fullName, 'Alex Santos');
});

test('student importer rejects unsupported file types and oversized batches', async () => {
  await assert.rejects(() => readImportRows('students.pdf', Buffer.from('x').toString('base64')), /Use an .xlsx or .csv file/);
});
