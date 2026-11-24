'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('exceljs');
const registerSf2Routes = require('../sf2-routes');

const template = path.join(__dirname,'..','templates','School Form 2 (SF2) Daily Attendance Report of Learners.xlsx');
const learners = [{id:'A',name:'ALPHA',sex:'MALE'}, {id:'B',name:'BETA',sex:'FEMALE'}];
const result = rows => ({rows,rowCount:rows.length});
function weekdays(month) {
  const [year,m]=month.split('-').map(Number);
  return Array.from({length:new Date(Date.UTC(year,m,0)).getUTCDate()},(_,i)=>new Date(Date.UTC(year,m-1,i+1)))
    .filter(d=>![0,6].includes(d.getUTCDay())).map(d=>d.toISOString().slice(0,10));
}
async function exportFixture({personal=true,month='2026-01',pending=false,conflict=false}={}) {
  const dates=weekdays(month), closed=dates[0], days=dates.slice(1);
  const [a,b,c,d,e,f,g,h,i]=days;
  const qr=personal ? [{id:'A',date:a,late:false},{id:'B',date:a,late:false},{id:'A',date:g,late:false}]
    : days.map(date=>({id:'A',date}));
  const manual=personal ? [
    {id:'A',date:a,status:'PRESENT',periodId:'p1'},
    {id:'A',date:b,status:'LATE',periodId:'p1'},
    {id:'A',date:d,status:'ABSENT',periodId:'p1'},
    {id:'A',date:e,status:'EXCUSED',periodId:'p1'},
    {id:'A',date:g,status:'ABSENT',periodId:'p1'}
  ] : [{id:'B',date:a,status:'PRESENT',periodId:'p1'}];
  const schedule=dates.map(date=>({date,periodId:'p1',scheduled:date!==c,hasWeekdays:date!==i,startTime:date===h?'11:00':'08:00'}));
  const overrides=personal ? [] : days.slice(1).filter((_,idx)=>!pending||idx!==0).map(date=>({id:'B',date,absenceType:'UNEXCUSED'}));
  const pool={query:async (sql)=>{
    if(sql.includes('ALTER TABLE students')) return result([]);
    if(sql.includes('SELECT 1') && sql.includes('UNION ALL') && sql.includes('teacher_period_assignments')) return result([{}]);
    if(sql.includes('SELECT s.student_id AS id,s.full_name')) return result(learners);
    if(sql.includes('SELECT DISTINCT m.student_id') && sql.includes('JOIN attendance_events')) return result(personal||conflict?[{id:'A',date:g}]:[]);
    if(sql.includes('FROM manual_attendance_marks m')) return result(manual);
    if(sql.includes('SELECT DISTINCT e.student_id AS id') && sql.includes('FROM attendance_events')) return result(qr);
    if(sql.includes('FROM sf2_daily_overrides o')) return result(overrides);
    if(sql.includes('COUNT(DISTINCT e.school_date)')) return result([{id:'A',count:2}]);
    if(sql.includes('FROM school_calendar_exceptions')) return result([{date:closed,type:'CLOSED'},{date:h,type:'CLASS_SUSPENSION',suspensionTime:'10:00'}]);
    if(sql.includes('FROM generate_series') && sql.includes('class_period_days')) return result(schedule);
    if(sql.includes('FROM school_settings')) return result([{setting_key:'school_name',setting_value:'TEST SCHOOL'}]);
    if(sql.includes('SELECT start_date FROM school_years')) return result([{start_date:'2025-06-01'}]);
    if(sql.includes('FROM student_enrollments e JOIN school_years sy')) return result(learners.map(x=>({sex:x.sex,student_id:x.id,enrollmentDate:'2025-06-01'})));
    if(sql.includes('FROM student_movements m')) return result([]);
    throw Error('Unexpected fixture SQL: '+sql);
  }};
  const routes={};
  const app={};
  for(const method of ['get','post','put','delete','patch']) app[method]=(url,...handlers)=>{routes[method+url]=handlers.at(-1);};
  const noop=()=>{};
  registerSf2Routes(app,pool,{authenticateSchoolClient:noop,requireSchoolUser:noop,requireSchoolAdmin:noop,requireSchoolAdminOrDepartmentHead:noop});
  const req={query:{month,gradeLevel:'9',section:'TEST',mode:personal?'PERSONAL':'OFFICIAL'},auth:{schoolId:'school-fixture',userId:'teacher-fixture',role:personal?'TEACHER':'SCHOOL_ADMIN',teacherDesignations:['SUBJECT_TEACHER']}};
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(v){this.bytes=v;return this;}};
  await routes['get/api/sf2/export'](req,res);
  if(res.code!==200) return {res,days};
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(res.bytes);
  return {res,days,workbook,sheet:workbook.worksheets[0]};
}
test('actual subject XLSX removes diagonal borders, distinguishes daily evidence, and keeps totals honest',async()=>{
  const {res,sheet,workbook,days}=await exportFixture();
  assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(sheet.name,'SF2 Subject Copy');
  assert.deepEqual(Array.from({length:9},(_,i)=>sheet.getCell(14,i+4).value),['P','L','—','X','E','NR','!','—','NR']);
  for(const row of [14,15,34,36,37,60]) for(let col=4;col<=28;col++) {
    assert.ok(!sheet.getCell(row,col).border?.diagonal,'Unexpected diagonal at '+row+','+col);
  }
  assert.equal(sheet.getCell('D15').value,null);
  assert.equal(sheet.getCell('D62').value,2);
  assert.equal(sheet.getCell('E62').value,1);
  assert.equal(sheet.getCell('F62').value,null);
  assert.equal(sheet.getCell('G62').value,0);
  assert.equal(sheet.getCell('I62').value,null);
  assert.equal(sheet.getCell('AC14').value,null);
  assert.equal(sheet.getCell('AD14').value,null);
  assert.equal(sheet.getCell('AE65').value,null);
  assert.ok(sheet.getCell('D62').alignment.textRotation===0 || !sheet.getCell('D62').alignment.textRotation);
  assert.equal(sheet.getCell(62,4+days.length).value,null);
  assert.ok(workbook.getWorksheet('READ ME - Unofficial'));
});
test('future subject dates have no attendance symbols or totals',async()=>{
  const {res,sheet}=await exportFixture({month:'2099-01'});
  assert.equal(res.code,200,JSON.stringify(res.body));
  for(let col=4;col<=28;col++) {
    assert.equal(sheet.getCell(14,col).value,null);
    assert.equal(sheet.getCell(36,col).value,null);
    assert.equal(sheet.getCell(62,col).value,null);
  }
});
test('actual official XLSX preserves official marks, grouping, instructions, and summary',async()=>{
  const {res,sheet,workbook,days}=await exportFixture({personal:false});
  assert.equal(res.code,200,JSON.stringify(res.body));
  const original=new ExcelJS.Workbook();
  await original.xlsx.readFile(template);
  const source=original.worksheets[0];
  assert.equal(sheet.name,source.name);
  assert.equal(sheet.getCell('D10').value,source.getCell('D10').value);
  assert.equal(sheet.getCell('B14').value,'ALPHA');
  assert.equal(sheet.getCell('B36').value,'BETA');
  assert.equal(sheet.getCell('D14').value,null);
  assert.equal(sheet.getCell('D36').value,null);
  assert.equal(sheet.getCell('E36').value,'X');
  assert.deepEqual(sheet.getCell('D14').border?.diagonal,source.getCell('D14').border?.diagonal);
  assert.ok(!sheet.getCell('D15').border?.diagonal);
  assert.equal(sheet.getCell('D62').value,2);
  assert.equal(sheet.getCell('E62').value,1);
  assert.equal(sheet.getCell('AC36').value,days.length-1);
  assert.equal(sheet.getCell('AD14').value,2);
  assert.equal(sheet.getCell('AE65').value,days.length);
  assert.equal(sheet.getCell(62,4+days.length).value,null);
  assert.equal(workbook.worksheets.length,1);
  for(const merge of source.model.merges) assert.ok(sheet.model.merges.includes(merge));
});
test('official export still blocks unresolved days and conflicting same-period evidence',async()=>{
  const pending=await exportFixture({personal:false,pending:true});
  assert.equal(pending.res.code,409);
  const conflict=await exportFixture({personal:false,conflict:true});
  assert.equal(conflict.res.code,409);
});
