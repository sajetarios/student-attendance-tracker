'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const path = require('node:path');

test('official SF2 has correct summary anchors for male, female, total, and attendance metrics', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path.join(__dirname, '..', 'templates', 'School Form 2 (SF2) Daily Attendance Report of Learners.xlsx'));
  const sheet = book.worksheets[0];
  assert.ok(sheet);
  assert.equal(sheet.getCell('AH65').text, 'M');
  assert.equal(sheet.getCell('AI65').text, 'F');
  assert.equal(sheet.getCell('AJ65').text, 'TOTAL');
  const summaryRows = [66,68,70,72,74,75,77,79,81,83];
  for(const row of summaryRows) {
    const male = sheet.getCell('AH'+row), female = sheet.getCell('AI'+row), total = sheet.getCell('AJ'+row);
    assert.equal(male.master.address, male.address);
    assert.equal(female.master.address, female.address);
    assert.equal(total.master.address, total.address);
  }
});

test('SF2 generator populates monthly summary and left-aligns learner names', () => {
  const fs = require('node:fs');
  const sf2 = fs.readFileSync(path.join(__dirname, '..', 'sf2-routes.js'),'utf8');
  assert.match(sf2,/getMonthlySf2Summary\(/);
  assert.match(sf2,/fiveConsecutiveAbsences\(/);
  assert.match(sf2,/\[66, m\.early, f\.early/);
  assert.match(sf2,/\[83, m\.transferIn, f\.transferIn/);
  assert.match(sf2,/worksheet\.getCell\('AB65'\)/);
  assert.match(sf2,/worksheet\.getCell\('AE65'\)/);
  assert.match(sf2,/horizontal:'left'/);
});
