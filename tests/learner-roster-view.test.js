const test = require('node:test');
const assert = require('node:assert/strict');
const roster = require('../public/learner-roster-view.js');

const sample = [
  { studentId: '3', fullName: 'Zulu, Fem', sex: 'Female' },
  { studentId: '1', fullName: 'Bravo, Male', sex: 'M' },
  { studentId: '4', fullName: 'Alpha, Unset', sex: null },
  { studentId: '2', fullName: 'Alpha, Female', sex: 'female' },
  { studentId: '5', fullName: 'Alpha, Male', sex: 'MALE' }
];

test('learner classification never drops records with unset sex', () => {
  assert.equal(roster.normalizeSex('female'), 'FEMALE');
  assert.equal(roster.normalizeSex('Male'), 'MALE');
  assert.equal(roster.normalizeSex(null), 'UNSPECIFIED');
  assert.deepEqual(roster.counts(sample), { MALE: 2, FEMALE: 2, UNSPECIFIED: 1, TOTAL: 5 });
});

test('grouped register places male then female then unclassified; each group numbers independently', () => {
  const sorted = roster.sortLearners(sample, true);
  const numbered = roster.numberLearners(sorted, true);
  assert.deepEqual(numbered.map(item => item.learner.studentId), ['5','1','2','3','4']);
  assert.deepEqual(numbered.map(item => item.number), [1,2,1,2,1]);
  assert.equal(new Set(sorted.map(item => item.studentId)).size, sample.length);
  assert.deepEqual(sample.map(item => item.studentId), ['3','1','4','2','5']);
});

test('unified view remains alphabetical and numbered consecutively', () => {
  const sorted = roster.sortLearners(sample);
  const numbered = roster.numberLearners(sorted);
  assert.deepEqual(numbered.map(item => item.number), [1,2,3,4,5]);
  assert.equal(numbered[0].learner.fullName, 'Alpha, Female');
});

test('paginated display uses the full list numbering without duplicates across pages', () => {
  const numbered = roster.numberLearners(roster.sortLearners(sample, true), true);
  const pages = [numbered.slice(0,2), numbered.slice(2,4), numbered.slice(4,6)];
  assert.deepEqual(pages.flat().map(row => row.learner.studentId), ['5','1','2','3','4']);
  assert.deepEqual(pages.flat().map(row => row.number), [1,2,1,2,1]);
});
