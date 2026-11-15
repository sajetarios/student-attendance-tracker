'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const path = require('node:path');
test('official SF2 template summary cells are locatable for formulas and totals', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path.join(__dirname, '..', 'templates', 'School Form 2 (SF2) Daily Attendance Report of Learners.xlsx'));
  const sheet = book.worksheets[0];
  assert.ok(sheet, 'Official template must be present');
  const hits = [];
  sheet.eachRow({includeEmpty:false}, (row, number) => {
    const values = [];
    row.eachCell({includeEmpty:false}, cell => {
      const v = String(cell.text || '').replace(/\s+/g, ' ').trim();
      if (/summary for the month|enrol(?:l)?ment|average daily|percentage of|consecutive|transferred|drop out|no\. of days of classes|^month:|^M$|^F$|^TOTAL$/i.test(v)) {
        values.push({ a:cell.address, t:v.slice(0,85), master:cell.master?.address });
      }
    });
    if(values.length) hits.push({row:number,values});
  });
  assert.ok(hits.length, 'Expected to find the official SF2 summary panel');
  console.log('SF2_TEMPLATE_LAYOUT', JSON.stringify(hits.slice(-45)));
});
