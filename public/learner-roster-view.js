/* Attendigo shared learner ordering — presentation only, never changes enrollment records. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AttendigoRoster = api;
})(typeof window !== 'undefined' ? window : undefined, function() {
  'use strict';
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  function normalizeSex(value) {
    const sex = String(value || '').trim().toUpperCase();
    return sex === 'M' || sex === 'MALE' ? 'MALE'
      : sex === 'F' || sex === 'FEMALE' ? 'FEMALE'
      : 'UNSPECIFIED';
  }
  const sexOrder = { MALE: 0, FEMALE: 1, UNSPECIFIED: 2 };
  const sexLabels = { MALE: 'Male learners', FEMALE: 'Female learners', UNSPECIFIED: 'Sex not set' };
  function sortLearners(learners, grouped = false) {
    return [...(learners || [])].sort((a, b) =>
      (grouped ? sexOrder[normalizeSex(a.sex)] - sexOrder[normalizeSex(b.sex)] : 0) ||
      collator.compare(String(a.fullName || ''), String(b.fullName || '')) ||
      collator.compare(String(a.studentId || ''), String(b.studentId || '')));
  }
  function counts(learners) {
    const result = { MALE: 0, FEMALE: 0, UNSPECIFIED: 0, TOTAL: 0 };
    for (const learner of learners || []) {
      result[normalizeSex(learner.sex)] += 1;
      result.TOTAL += 1;
    }
    return result;
  }
  function numberLearners(learners, grouped = false) {
    const seen = { MALE: 0, FEMALE: 0, UNSPECIFIED: 0 };
    return (learners || []).map((learner, index) => {
      const sex = normalizeSex(learner.sex);
      seen[sex] += 1;
      return { learner, sex, number: grouped ? seen[sex] : index + 1 };
    });
  }
  return Object.freeze({ normalizeSex, sexLabels, sortLearners, counts, numberLearners });
});
