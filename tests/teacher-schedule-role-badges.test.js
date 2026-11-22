'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const {classify,relationshipLabels}=require('../public/schedule-relationships');

const myself={userId:'teacher-one',role:'TEACHER'};
const ownAdvisory=[{adviserUserId:'teacher-one',gradeLevel:'8',section:'SPJ Tuvera'}];
const otherAdvisory=[{adviserUserId:'teacher-two',gradeLevel:'8',section:'SPJ Tuvera'}];
const period=(section='SPJ Tuvera',scheduleType='SUBJECT',teacherId='teacher-one')=>({
  gradeLevel:'8',section,scheduleType,assignedTeacherUserId:teacherId
});

test('Teacher classes show both real subject and official adviser relationships independently',()=>{
  assert.deepEqual(classify(period('SPJ Tuvera','ADVISORY'),myself,ownAdvisory),{
    mySubject:true,myAdvisory:true,advisoryActivity:true
  });
  assert.deepEqual(relationshipLabels(classify(period('SPJ Tuvera','ADVISORY'),myself,ownAdvisory)),[
    'My subject class','My advisory section','Advisory / Homeroom activity'
  ]);
  assert.deepEqual(classify(period('Abueva','SUBJECT'),myself,ownAdvisory),{
    mySubject:true,myAdvisory:false,advisoryActivity:false
  });
  assert.deepEqual(classify(period('SPJ Tuvera','SUBJECT','teacher-two'),myself,ownAdvisory),{
    mySubject:false,myAdvisory:true,advisoryActivity:false
  });
});

test('ADVISORY schedule type never assigns Class Adviser permissions',()=>{
  const relation=classify(period('SPJ Tuvera','ADVISORY'),myself,[]);
  assert.equal(relation.myAdvisory,false);
  assert.equal(relation.mySubject,true);
  assert.equal(relation.advisoryActivity,true);
  assert.deepEqual(relationshipLabels(relation),['My subject class','Advisory / Homeroom activity']);
  assert.equal(classify(period('SPJ Tuvera','HOMEROOM'),myself,otherAdvisory).myAdvisory,false);
});

test('Official adviser match is school-scoped by API and must match self ID, grade and normalized section',()=>{
  const match=classify(period('  SPJ TUVERA ','subject'),myself,[
    {adviserUserId:'teacher-two',gradeLevel:'8',section:'SPJ TUVERA'},
    {adviserUserId:'teacher-one',gradeLevel:' 8 ',section:' spj tuvera '}
  ]);
  assert.equal(match.myAdvisory,true);
  assert.equal(classify(period('Abueva'),myself,ownAdvisory).myAdvisory,false);
  assert.equal(classify(period('SPJ Tuvera'),{userId:''},ownAdvisory).mySubject,false);
  assert.equal(classify(period('SPJ Tuvera','ADVISORY','teacher-two'),myself,otherAdvisory).myAdvisory,false);
  const server=read('server.js');
  assert.match(server,/app\.get\('\/api\/class-adviser-assignments', authenticateSchoolClient/);
  assert.match(server,/teacherFilter = ' AND ca\.adviser_user_id=\$2'/);
  assert.match(server,/WHERE ca\.school_id=\$1\$\{teacherFilter\}/);
});

test('Weekly grid actually renders independent role badges and never mislabels homeroom as personal advisory',()=>{
  const fakeWindow={addEventListener() {},matchMedia(){return {matches:false};}};
  const fakeDocument={addEventListener() {}};
  const sandbox={window:fakeWindow,document:fakeDocument,AbortController,clearTimeout,setTimeout};
  vm.runInNewContext(read('public/timetable-grid.js'),sandbox,{filename:'timetable-grid.js'});
  const host={
    html:'',classList:{add(){}},addEventListener(){},
    set innerHTML(value){this.html=value;},get innerHTML(){return this.html;}
  };
  const make=(n,rel)=>({
    periodId:n,subjectName:'English 8',gradeLevel:'8',section:'SPJ Tuvera',
    assignedTeacherName:'Teacher',startTime:'07:30',endTime:'08:25',
    dayIndex:1,date:'2026-11-16',teacherScheduleView:true,
    isMySubjectClass:rel.mySubject,isMyAdvisorySection:rel.myAdvisory,
    isAdvisoryActivity:rel.advisoryActivity,
    relationshipLabels:relationshipLabels(rel)
  });
  fakeWindow.TimetableGrid.render({
    host,days:[1],weekdayDates:{1:'2026-11-16'},today:'2026-11-16',
    entries:[
      make('one',classify(period('SPJ Tuvera','ADVISORY'),myself,ownAdvisory)),
      {...make('two',classify(period('Abueva','SUBJECT'),myself,ownAdvisory)),startTime:'08:25',endTime:'09:20'}
    ]
  });
  assert.match(host.html,/tt-tone-teacher-both/);
  assert.match(host.html,/tt-tone-teacher-class/);
  assert.match(host.html,/tt-relation-subject/);
  assert.match(host.html,/tt-relation-advisory/);
  assert.match(host.html,/My subject class/);
  assert.match(host.html,/My advisory section/);
  assert.doesNotMatch(host.html,/tt-tone-advisory-activity/);
  assert.doesNotMatch(host.html,/Other teaching class/);
  assert.match(host.html,/tt-legend-both/);
});

test('Weekly/list/popover UI preserve actual assignment labels in every display',()=>{
  const portal=read('public/portal.js');
  const grid=read('public/timetable-grid.js');
  const html=read('public/portal.html');
  const sw=read('public/sw.js');
  const css=read('public/teacher-timetable-identities.css');
  assert.match(portal,/window\.AttendigoScheduleRelationships\.classify\(period, user, adviserAssignments\)/);
  assert.match(portal,/window\.AttendigoScheduleRelationships\.relationshipLabels\(teacherRelationship\(period\)\)/);
  assert.match(portal,/isMySubjectClass:relationship\.mySubject/);
  assert.match(portal,/teacher-list-relationship/);
  assert.match(grid,/\['Your role',labels\.join\(' \+ '\)/);
  assert.match(grid,/\['Period type',entry\.isAdvisoryActivity\?/);
  assert.match(grid,/const rows=items\.map\(/);
  assert.match(grid,/e\.isMySubjectClass&&e\.isMyAdvisorySection\?'teacher-both'/);
  assert.match(css, /\.tt-tone-teacher-both/);
  assert.match(css, /html\[data-ui-theme="dark"\]/);
  assert.match(html,/href="\/teacher-timetable-identities\.css\?v=1"/);
  assert.match(html,/src="\/schedule-relationships\.js\?v=1" defer/);
  assert.match(html,/src="\/timetable-grid\.js\?v=7" defer/);
  assert.match(html,/src="\/portal\.js\?v=226" defer/);
  for (const asset of ['/teacher-timetable-identities.css?v=1','/schedule-relationships.js?v=1','/timetable-grid.js?v=7','/portal.js?v=226'])
    assert.ok(sw.includes('"'+asset+'"'),'Missing precache for '+asset);
});

test('Existing server-side schedule permissions and export calculations are untouched',()=>{
  const portal=read('public/portal.js');
  const server=read('server.js');
  assert.match(portal,/const effectivePeriods = periods\.filter\(period =>/);
  assert.match(portal,/user\.role !== 'TEACHER' \|\| String\(period\.assignedTeacherUserId \|\| ''\) === String\(user\.userId \|\| ''\)/);
  assert.match(server,/app\.get\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'\)/);
  assert.match(portal,/window\.TimetableGrid\.render\(/);
  assert.doesNotMatch(read('public/schedule-relationships.js'),/fetch\s*\(|\.post\s*\(|localStorage|ATTENDANCE|UPDATE\s+|DELETE\s+|INSERT\s+/i);
});
