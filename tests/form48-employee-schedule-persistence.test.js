'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {readEmployeeSchedule}=require('../form48-employee-schedules');
const {mergeSchoolForm48Defaults}=require('../form48-bulk-routes');
const id='22222222-2222-4222-8222-222222222222';
const hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const make=(extra={})=>({staffUserId:id,revision:0,workdays:[1,2,3,4,5],
 regularHours:hours,saturdayHours:{},...extra});
test('employee prescribed work hours require complete chronological AM and PM values',()=>{
 assert.deepEqual(readEmployeeSchedule(make()),make());
 assert.equal(readEmployeeSchedule(make({regularHours:{...hours,PM_OUT:''}})),null);
 assert.equal(readEmployeeSchedule(make({regularHours:{...hours,AM_OUT:'07:59'}})),null);
 assert.equal(readEmployeeSchedule(make({workdays:[]})),null);
 assert.equal(readEmployeeSchedule(make({workdays:[1,1]})),null);
 assert.equal(readEmployeeSchedule(make({revision:-1})),null);
 assert.equal(readEmployeeSchedule(make({staffUserId:'different-school-user'})),null);
 assert.equal(readEmployeeSchedule(make({workdays:[1,2,3,4,5,6]})),null);
 assert.deepEqual(readEmployeeSchedule(make({workdays:[6],regularHours:{},saturdayHours:hours})).workdays,[6]);
});
test('new month recognizes employee hours first and school-wide values second',()=>{
 const school={workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},
  verifiedBy:'In Charge',approvedBy:'School Principal',verifiedPosition:'Admin Officer',approvedPosition:'Principal'};
 const employee={workdays:[1,2,3,4,5,6],regularHours:hours,saturdayHours:
  {AM_IN:'09:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'},revision:1};
 const inherited=mergeSchoolForm48Defaults(null,school,employee);
 assert.equal(inherited.configured,true);
 assert.deepEqual(inherited.workdays,[1,2,3,4,5,6]);
 assert.equal(inherited.saturdayHours.AM_IN,'09:00');
 assert.equal(inherited.verifiedBy,'In Charge');
 assert.equal(inherited.approvedBy,'School Principal');
 const onlySchool=mergeSchoolForm48Defaults(null,school);
 assert.equal(onlySchool.configured,true);
 assert.deepEqual(onlySchool.workdays,[1,2,3,4,5]);
 const partialMonth={configured:true,revision:2,workdays:[1,2,3,4,5],
  regularHours:{},saturdayHours:{},dayReviews:{'2026-11-03':'EXCUSED'}};
 const repaired=mergeSchoolForm48Defaults(partialMonth,school,employee);
 assert.equal(repaired.configured,true);
 assert.equal(repaired.regularHours.AM_IN,'08:00');
 assert.equal(repaired.dayReviews['2026-11-03'],'EXCUSED');
 const historical={...partialMonth,regularHours:{AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'}};
 const preserved=mergeSchoolForm48Defaults(historical,school,employee);
 assert.equal(preserved.regularHours.AM_IN,'07:00');
 assert.equal(preserved.revision,2);
});
test('schedule settings have separate Save control and are not dependent on preview or printing',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','public','portal.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','public','form48-report.js'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'..','form48-employee-schedules.js'),'utf8');
 const review=fs.readFileSync(path.join(__dirname,'..','form48-review-routes.js'),'utf8');
 const migration=fs.readFileSync(path.join(__dirname,'..','migrations','058_staff_form48_employee_schedules.sql'),'utf8');
 const sw=fs.readFileSync(path.join(__dirname,'..','public','sw.js'),'utf8');
 assert.match(html,/id="form48SaveSchedule"/);
 assert.match(html,/id="form48ScheduleSaveStatus"/);
 assert.match(js,/saveSchedule\.addEventListener\('click'/);
 assert.match(js,/form48\/schedule/);
 assert.match(js,/monthlyRevision/);
 assert.match(js,/scheduleReady/);
 assert.match(server,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(server,/school_id=\$1 AND staff_user_id=\$2/);
 assert.match(server,/FOR SHARE/);
 assert.match(server,/FORM48_EMPLOYEE_SCHEDULE_UPDATED/);
 assert.match(server,/FORM48_EMPLOYEE_SCHEDULE_UPDATED[\s\S]*?await client\.query\('COMMIT'\)/);
 assert.match(server,/report_month=\$3::date FOR UPDATE/);
 assert.match(server,/revision=staff_form48_employee_schedules\.revision\+1/);
 assert.doesNotMatch(server,/UPDATE\s+staff_attendance_events/);
 assert.match(review,/getEmployeeForm48Schedule/);
 assert.match(review,/mergeSchoolForm48Defaults\(rawSettings,defaults,employeeSchedule\)/);
 assert.match(migration,/FOREIGN KEY \(school_id,staff_user_id\)/);
 assert.match(sw,/form48-report\.js\?v=7/);
 assert.match(sw,/form48-report\.css\?v=7/);
});
