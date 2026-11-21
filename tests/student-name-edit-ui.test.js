'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const names = require('../public/student-name-format.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('official surname and given names remain distinct without guessing legacy names', () => {
  const verified = names.parse('DE LA CRUZ, MARIA TERESA REYES');
  assert.deepEqual(verified, {
    verified: true, surname: 'DE LA CRUZ',
    givenNames: 'MARIA TERESA REYES', original: 'DE LA CRUZ, MARIA TERESA REYES'
  });
  const legacy = names.parse('MARIA TERESA REYES DE LA CRUZ');
  assert.equal(legacy.verified, false);
  assert.equal(legacy.original, 'MARIA TERESA REYES DE LA CRUZ');
  assert.equal(legacy.surname, '');
  assert.equal(legacy.givenNames, '');
});
test('name correction preserves compound surnames, suffixes, and maximum length', () => {
  assert.equal(names.compose('DE LA CRUZ', 'JUAN M. JR.'), 'DE LA CRUZ, JUAN M. JR.');
  assert.equal(names.compose('MAGONCIA','ANDRIANA BELOY'), 'MAGONCIA, ANDRIANA BELOY');
  assert.throws(() => names.compose('','JUAN'), /official surname/);
  assert.throws(() => names.compose('DE LA CRUZ',''), /official surname/);
  assert.throws(() => names.compose('A'.repeat(100),'B'.repeat(110)), /200 characters/);
});
test('authorized editor keeps IDs and QR tokens unchanged and protects teacher SF1 fields', () => {
  const page = read('public/portal.html');
  const client = read('public/portal.js');
  const server = read('server.js');
  const worker = read('public/sw.js');
  for (const id of ['editStructuredNameToggle','editSurname','editGivenNames',
    'editFatherName','editMotherMaidenName','editSf1GuardianName','editBirthDate','editSf1Address']) {
    assert.ok(page.includes('id="' + id + '"'), id);
  }
  assert.match(client, /studentRosterName\(student, ordinal\)/);
  assert.match(client, /editStructuredNameToggle/);
  assert.match(client, /editFamilySectionTitle/);
  assert.match(client, /data-edit-student/);
  assert.match(server, /isTeacher && !isClassAdviser && !isSubjectTeacher/);
  assert.match(server, /if \(!isTeacher\) \{/);
  assert.match(server, /TEACHER_STUDENT_SCOPE/);
  assert.match(server, /qrTokenPreserved: true/);
  assert.match(server, /SCHOOL_ADMIN_UPDATE_STUDENT/);
  assert.ok(worker.includes('"/student-name-format.js?v=1"'));
  assert.ok(page.includes('/student-name-format.js?v=1'));
});
