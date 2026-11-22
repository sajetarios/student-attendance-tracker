'use strict';
/* Distinguish verified assignment relationships from the schedule's activity type.
   Never infer Class Adviser status from a class subject, color or the teacher's
   department. A section may be advised by one teacher but taught by another. */
(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.AttendigoScheduleRelationships=api;
})(typeof window!=='undefined'?window:null,function(){
  const normal = value => String(value==null?'':value).trim().toLocaleLowerCase('en');
  function classify(period,user,assignments) {
    const self=String(user?.userId||'');
    const grade=normal(period?.gradeLevel);
    const section=normal(period?.section);
    const teacherId=period?.assignedTeacherUserId;
    const mySubject=Boolean(self && teacherId && String(teacherId)===self);
    const myAdvisory=Boolean(self && grade && section && Array.isArray(assignments) &&
      assignments.some(item=>String(item?.adviserUserId||'')===self &&
        normal(item.gradeLevel)===grade && normal(item.section)===section));
    const advisoryActivity=['ADVISORY','HOMEROOM'].includes(String(period?.scheduleType||'').toUpperCase());
    return { mySubject, myAdvisory, advisoryActivity };
  }
  function relationshipLabels(relationship) {
    const labels=[];
    if(relationship.mySubject) labels.push('My subject class');
    if(relationship.myAdvisory) labels.push('My advisory section');
    if(relationship.advisoryActivity) labels.push('Advisory / Homeroom activity');
    return labels;
  }
  return Object.freeze({classify,relationshipLabels});
});