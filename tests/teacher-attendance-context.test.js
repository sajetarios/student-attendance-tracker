'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');

test('teacher attendance group explains advisory and subject scope without introducing duplicate records', () => {
  assert.match(html, /id="teacherAttendanceViewSelect" aria-describedby="teacherAttendanceGroupHint"/);
  assert.match(html, /id="teacherAttendanceGroupHint"[^>]*>Choose advisory attendance/);
  assert.match(html, /do not create duplicate learner records/);
  for (const value of ['ALL', 'ADVISORY', 'SUBJECT']) {
    assert.match(html, new RegExp('<option value="' + value + '"'));
  }
});
