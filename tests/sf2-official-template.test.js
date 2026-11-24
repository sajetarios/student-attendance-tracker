'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(
  root,
  'templates',
  'School Form 2 (SF2) Daily Attendance Report of Learners.xlsx'
);

test('official DepEd SF2 template exists and can be loaded', async () => {
  assert.ok(fs.existsSync(templatePath), 'Official SF2 template is missing');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, 'School Form 2 (SF2)');
});

test('official SF2 template retains required header merge ranges', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const merges = workbook.worksheets[0].model.merges;

  for (const range of [
    'C6:E6',
    'K6:O6',
    'X6:AC6',
    'X8:Y8',
    'AC8:AH8'
  ]) {
    assert.ok(merges.includes(range), `Missing template merge: ${range}`);
  }
});

test('official SF2 date and weekday rows remain separate from instructions', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const sheet = workbook.worksheets[0];

  assert.match(String(sheet.getCell('D10').value), /1st row for date/);
  assert.notEqual(sheet.getCell('D10').value, null);
  assert.equal(sheet.getCell('D11').value, null);
  assert.equal(sheet.getCell('D12').value, null);
});

test('official SF2 route uses the official template and protects attendance conflicts', () => {
  const routes = fs.readFileSync(path.join(root, 'sf2-routes.js'), 'utf8');

  assert.match(routes, /School Form 2 \(SF2\) Daily Attendance Report of Learners\.xlsx/);
  assert.match(routes, /const conflictSet = new Set/);
  assert.match(routes, /if \(conflictSet\.has\(key\)\) return 'CONFLICT'/);
  assert.match(routes, /if \(!personalCopy && data\.summary\.conflicts\)/);
  assert.match(routes, /buildOfficialWorkbook\(req, month, gradeLevel, section, data\)/);
});

test('reference SF2 generator supports 50 male and 50 female learner slots without overlap', () => {
  const routes = fs.readFileSync(path.join(root, 'sf2-routes.js'), 'utf8');
  const { LAYOUT } = require('../sf2-reference-workbook');
  assert.match(routes, /boys\.length > 50 \|\| girls\.length > 50/);
  assert.equal(LAYOUT.capacity, 50);
  assert.equal(LAYOUT.firstMale + LAYOUT.capacity, LAYOUT.maleTotal);
  assert.equal(LAYOUT.firstFemale + LAYOUT.capacity, LAYOUT.femaleTotal);
  assert.equal(LAYOUT.femaleTotal + 1, LAYOUT.total);
  assert.equal(LAYOUT.firstDate + LAYOUT.dates, LAYOUT.absent);
});
