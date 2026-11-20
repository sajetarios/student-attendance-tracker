'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
const script=fs.readFileSync('public/shs-school-ui.js','utf8');

test('SHS pathway loads new revision with disabled choices and an enrollment action',()=>{
 for(const id of ['shsPathState','shsPathStatusTitle','shsPathStatusText',
  'shsPathEnroll','shsPathCurriculumSummary'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/id="shsPathTrack" required disabled/);
 assert.match(html,/id="shsPathStrand"[^>]*disabled/);
 assert.match(html,/id="shsLearnerPathForm"[\s\S]*?<button type="submit" class="primary-button" disabled>Save learner pathway/);
 for(const asset of ['shs-school-ui.js?v=2','shs-school-ui.css?v=2']){
  assert.ok(html.includes('/'+asset));
  assert.ok(sw.includes('"/'+asset+'"'));
 }
 assert.match(sw,/attendigo-v262-form48-a4-gate-evidence/);
});

test('live SHS learner pathway blocks editing until selected and never shows wrong curriculum tracks',async()=>{
 const controls=new Map();
 function element(id){
  const handlers=new Map();
  const control={
   id,value:'',textContent:'',hidden:false,disabled:false,options:[],dataset:{},classList:{toggle(){}},
   append(...children){this.options.push(...children);},
   replaceChildren(...children){this.options=children;},
   addEventListener(type,fn){handlers.set(type,fn);},
   dispatchEvent(evt){return handlers.get(evt.type)?.(evt);},
   focus(){this.didFocus=true;},
   scrollIntoView(){this.didScroll=true;},
   querySelector(sel){
    if(sel==='[type="submit"]')return controls.get(id+'Submit')||null;
    if(sel==='input[name="studentId"]')return controls.get('studentIdInput')||null;
    return null;
   }
  };
  return control;
 }
 const ids=['shsSchoolConfiguration','shsSchoolLevelMode','shsProgramPanel','shsCurriculumYear',
  'shsCurriculumGrade','shsCurriculumVersion','shsPilotConfirmationWrap','shsGrade12PilotConfirmed',
  'shsPathYear','shsPathEnrollment','shsPathTrack','shsPathStrand','shsPathState','shsPathStatusTitle',
  'shsPathStatusText','shsPathEnroll','shsPathCurriculumSummary','shsLearnerPathForm','shsLevelForm',
  'shsCurriculumForm','shsPathRefresh','shsPathFeedback','shsLevelFeedback',
  'shsCurriculumFeedback','academicSelectedYear','academicEnrollmentForm','studentIdInput',
  'shsLearnerPathFormSubmit','shsLevelFormSubmit','shsCurriculumFormSubmit'];
 for(const id of ids)controls.set(id,element(id));
 controls.get('shsCurriculumGrade').value='Grade 11';
 controls.get('shsCurriculumVersion').options=[{value:'STRENGTHENED'},{value:'LEGACY'}];
 const $=id=>controls.get(id)||null;
 const year='33333333-3333-4333-8333-333333333333';
 let learners=[],writes=0;
 const fetch=async(url,opts={})=>{
  if(opts.method==='PUT'||opts.method==='POST')writes++;
  let body;
  if(url==='/api/shs/config')body={
   mode:'INTEGRATED',
   schoolYears:[{schoolYearId:year,label:'2026-2027',status:'ACTIVE'}],
   curricula:[]
  };
  else if(url.startsWith('/api/shs/enrollment-paths?'))body={items:learners};
  else throw Error('Unexpected request '+url);
  return {ok:true,json:async()=>body};
 };
 const document={
  getElementById:$,createElement:()=>element('new'),
  addEventListener(){},
 };
 const Event=class{constructor(type){this.type=type;}};
 vm.runInNewContext(script,{document,window:{attendigoStaffIdentity:Promise.resolve({role:'SCHOOL_ADMIN'})},fetch,Event});
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
 await settle();
 assert.equal($('shsPathEnrollment').disabled,true);
 assert.equal($('shsPathTrack').disabled,true);
 assert.equal($('shsPathStrand').disabled,true);
 assert.equal($('shsLearnerPathFormSubmit').disabled,true);
 assert.equal($('shsPathTrack').options.length,1);
 assert.equal($('shsPathTrack').options[0].value,'');
 assert.equal($('shsPathEnroll').hidden,false);
 assert.match($('shsPathStatusTitle').textContent,/No SHS learners/);
 // Link leads to the existing enrollment form; it must not create a record.
 $('shsPathEnroll').dispatchEvent(new Event('click'));
 assert.equal($('academicSelectedYear').value,year);
 assert.equal($('academicEnrollmentForm').didScroll,true);
 assert.equal($('studentIdInput').didFocus,true);
 assert.equal(writes,0);
 learners=[
  {enrollmentId:'e11',fullName:'Synthetic Eleven',gradeLevel:'Grade 11',section:'A',track:'ACADEMIC'},
  {enrollmentId:'e12',fullName:'Synthetic Twelve',gradeLevel:'Grade 12',section:'B',track:'TVL'}
 ];
 $('shsPathRefresh').dispatchEvent(new Event('click'));
 await settle();
 assert.equal($('shsPathEnrollment').disabled,false);
 assert.equal($('shsPathEnroll').hidden,true);
 assert.equal($('shsPathTrack').disabled,true,'an enrollment must be explicitly selected');
 $('shsPathEnrollment').value='e11';
 $('shsPathEnrollment').dispatchEvent(new Event('change'));
 assert.equal($('shsPathTrack').disabled,false);
 assert.equal($('shsPathStrand').disabled,false);
 assert.equal($('shsLearnerPathFormSubmit').disabled,false);
 assert.deepEqual(Array.from($('shsPathTrack').options,option=>option.value),['ACADEMIC','TECHPRO']);
 assert.match($('shsPathCurriculumSummary').textContent,/Grade 11.*Strengthened SHS/);
 $('shsPathEnrollment').value='e12';
 $('shsPathEnrollment').dispatchEvent(new Event('change'));
 assert.deepEqual(Array.from($('shsPathTrack').options,option=>option.value),['ACADEMIC','TVL','SPORTS','ARTS_AND_DESIGN']);
 assert.match($('shsPathCurriculumSummary').textContent,/Grade 12.*legacy SHS/);
 $('shsPathEnrollment').value='';
 $('shsPathEnrollment').dispatchEvent(new Event('change'));
 assert.equal($('shsPathTrack').disabled,true);
 assert.equal($('shsPathStrand').disabled,true);
 assert.equal($('shsLearnerPathFormSubmit').disabled,true);
 assert.equal(writes,0);
});
