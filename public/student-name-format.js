/* Safe learner name presentation. Never infer a surname from an unstructured legacy name. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AttendigoStudentName = api;
})(typeof window !== 'undefined' ? window : undefined, function() {
  'use strict';
  const tidy = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  function parse(fullName) {
    const original = tidy(fullName);
    const comma = original.indexOf(',');
    if (comma < 1) return { verified: false, surname: '', givenNames: '', original };
    const surname = tidy(original.slice(0, comma));
    const givenNames = tidy(original.slice(comma + 1));
    // No guesswork: only a name with an explicit surname delimiter qualifies.
    if (!surname || !givenNames) return { verified: false, surname: '', givenNames: '', original };
    return { verified: true, surname, givenNames, original };
  }
  function compose(surnameInput, givenInput) {
    const surname = tidy(surnameInput);
    const givenNames = tidy(givenInput);
    if (!surname || !givenNames || surname.includes(','))
      throw new Error('Enter the official surname and given/middle names separately.');
    const fullName = surname + ', ' + givenNames;
    if (fullName.length > 200) throw new Error('The complete name must be 200 characters or less.');
    return fullName;
  }
  function composeParts(lastInput, firstInput, middleInput = '') {
    const lastName=tidy(lastInput), firstName=tidy(firstInput),middleName=tidy(middleInput);
    if(!lastName||!firstName||lastName.length>100||firstName.length>160||
       middleName.length>160||[lastName,firstName,middleName].some(value=>value.includes(',')))
      throw new Error('Surname and first name are required; middle name is optional.');
    const fullName=lastName+', '+firstName+(middleName?' '+middleName:'');
    if(fullName.length>200)throw new Error('The complete name must be 200 characters or less.');
    return {lastName,firstName,middleName,fullName};
  }
  return Object.freeze({ parse, compose, composeParts });
});
