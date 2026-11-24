'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('exceljs');
const registerSf2Routes = require('../sf2-routes');

const template = path.join(__dirname,'..','templates','School Form 2 (SF2) Daily Attendance Report of Learners.xlsx');
const learners = [{id:'A',name:'ALPHA',sex:'MALE'}, {id:'B',name:'BETA',sex:'FEMALE'}];
const result = rows => ({rows,rowCount:rows.length});
// ExcelJS cell.value copies formula metadata using truthiness; cell.result retains numeric zero.
const value = cell => cell.formula ? cell.result : cell.value;
const {referenceDateSlots}=require('../sf2-reference-workbook');
const dayCell=(sheet,days,row,index)=>sheet.getCell(row,7+referenceDateSlots(days[0].slice(0,7),days).slots.indexOf(index));
const blankSlots=(sheet,days)=>referenceDateSlots(days[0].slice(0,7),days).slots.forEach((i,slot)=>{if(i<0)assert.equal(sheet.getCell(115,7+slot).value,null);});
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
    if(sql.includes('COUNT(DISTINCT e.school_date)')) return result([{id:'A',count:2,lateDates:[a,b]}]);
    if(sql.includes('FROM school_calendar_exceptions')) return result([{date:closed,type:'CLOSED'},{date:h,type:'CLASS_SUSPENSION',suspensionTime:'10:00'}]);
    if(sql.includes('FROM generate_series') && sql.includes('class_period_days')) return result(schedule);
    if(sql.includes("SELECT 'ADVISER' AS kind"))return result([{kind:'ADVISER',name:'TEST ADVISER'},{kind:'HEAD',name:'TEST HEAD'}]);
    if(sql.includes('SELECT school_name,school_code FROM schools')) return result([{school_name:'TEST SCHOOL',school_code:'123456'}]);
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
function assertNoManualCalculationPanel(sheet){
  for(const address of ['AO6','AO9','AQ9','AO13','AO14','AP14','AO15','AP15','AO16','AP16','AO18','AP18']) {
    assert.equal(sheet.getCell(address).value,null,address+' must be blank');
  }
  for(let column=41;column<=72;column++) assert.equal(sheet.getColumn(column).hidden,true,'Nonprinted column '+column+' must be hidden');
  assert.equal(sheet.getColumn(40).hidden,false,'Printable boundary must stay visible');
  assert.equal(sheet.pageSetup.printArea,'A1:AN146');
}
test('actual subject XLSX removes diagonal borders, distinguishes daily evidence, and keeps totals honest',async()=>{
  const {res,sheet,workbook,days}=await exportFixture();
  assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(sheet.name,'SF2 Subject Copy');
  assertNoManualCalculationPanel(sheet);
  assert.deepEqual(Array.from({length:9},(_,i)=>dayCell(sheet,days,13,i).value),[null,null,'—','X','E',null,'!','—',null]);
  for(const row of [13,14,62,64,65,113]) for(let col=7;col<=31;col++) {
    assert.ok(!sheet.getCell(row,col).border?.diagonal,'Unexpected diagonal at '+row+','+col);
  }
  assert.equal(sheet.getCell('G14').value,null);
  const shade=dayCell(sheet,days,13,1).fill;
  assert.equal(shade.type,'gradient');
  assert.equal(shade.degree,90);
  assert.equal(shade.stops[0].color.argb,'FF000000');
  assert.equal(shade.stops.at(-1).color.argb,'FFFFFFFF');
  assert.equal(dayCell(sheet,days,13,5).fill.fgColor.argb,'FFD9D9D9');
  assert.notEqual(dayCell(sheet,days,13,0).fill?.fgColor?.argb,'FFD9D9D9');
  assert.equal(sheet.getColumn('AU').hidden,true);
  assert.equal(sheet.getCell('G6').value,'123456');
  assert.equal(sheet.getCell('G7').value,'TEST SCHOOL');
  assert.equal(value(dayCell(sheet,days,115,0)),2);
  assert.equal(value(dayCell(sheet,days,115,1)),1);
  assert.equal(value(dayCell(sheet,days,115,2)),null);
  assert.equal(value(dayCell(sheet,days,115,3)),0);
  assert.equal(value(dayCell(sheet,days,115,5)),null);
  assert.equal(value(sheet.getCell('AF13')),1);
  assert.equal(value(sheet.getCell('AG13')),2);
  assert.match(sheet.getCell('AF13').formula,/COUNTIF\(AU13:BS13,"X"\)/);
  assert.match(sheet.getCell('AG13').formula,/COUNTIF\(AU13:BS13,"P"\)/);
  assert.equal(sheet.getColumn('AU').hidden,true);
  assert.equal(sheet.getColumn('BS').hidden,true);
  assert.equal(sheet.getCell('AJ117').value,null);
  assert.equal(sheet.getCell('AK119').value,null);
  assert.ok(sheet.getCell('G115').alignment.textRotation===0 || !sheet.getCell('G115').alignment.textRotation);
  blankSlots(sheet,days);
  assert.equal(workbook.worksheets.length,1);
  assert.equal(sheet.getRow(14).hidden,true);
  assert.equal(sheet.getRow(64).hidden,false);
  assert.match(String(sheet.getCell('A3').value),/UNOFFICIAL/);
  assert.match(String(sheet.getCell('T118').value),/not absent/);
});
test('future subject dates have no attendance symbols or totals',async()=>{
  const {res,sheet}=await exportFixture({month:'2099-01'});
  assert.equal(res.code,200,JSON.stringify(res.body));
  for(let col=7;col<=31;col++) {
    assert.equal(sheet.getCell(13,col).value,null);
    assert.equal(sheet.getCell(64,col).value,null);
    assert.equal(sheet.getCell(115,col).value,null);
  }
});
test('actual official XLSX follows reference geometry, preserves daily marks, grouping, instructions, and summary',async()=>{
  const {res,sheet,workbook,days}=await exportFixture({personal:false});
  assert.equal(res.code,200,JSON.stringify(res.body));
  const original=new ExcelJS.Workbook();
  await original.xlsx.readFile(template);
  const source=original.worksheets[0];
  assert.equal(sheet.name,source.name);
  assertNoManualCalculationPanel(sheet);
  assert.match(String(sheet.getCell('G9').value),/1st row for date/);
  assert.equal(sheet.getCell('B13').value,'ALPHA');
  assert.equal(sheet.getCell('B64').value,'BETA');
  assert.equal(dayCell(sheet,days,13,0).value,null);
  assert.equal(dayCell(sheet,days,13,0).fill.type,'gradient');
  assert.equal(dayCell(sheet,days,13,1).fill.type,'gradient');
  assert.notEqual(dayCell(sheet,days,13,2).fill?.type,'gradient');
  assert.equal(dayCell(sheet,days,64,0).value,null);
  assert.equal(dayCell(sheet,days,64,1).value,'X');
  assert.ok(!dayCell(sheet,days,13,0).border?.diagonal);
  assert.ok(!sheet.getCell('G14').border?.diagonal);
  assert.equal(value(dayCell(sheet,days,115,0)),2);
  assert.equal(value(dayCell(sheet,days,115,1)),1);
  assert.equal(value(sheet.getCell('AF64')),days.length-1);
  assert.equal(value(sheet.getCell('AG64')),1);
  assert.equal(sheet.getCell('BT13').value,2);
  assert.equal(sheet.getColumn('BT').hidden,true);
  assert.equal(sheet.getCell('AE140').value,'TEST ADVISER');
  assert.equal(sheet.getCell('AE145').value,'TEST HEAD');
  assert.equal(value(sheet.getCell('AJ117')),days.length);
  assert.equal(sheet.getCell('AJ117').formula,'COUNT(G10:AE10)');
  assert.equal(Array.from({length:25},(_,i)=>sheet.getCell(10,7+i).value).filter(v=>typeof v==='number').length,days.length);
  assert.equal(sheet.getCell('K10').value,2);
  assert.equal(sheet.getCell('J10').value,null);
  blankSlots(sheet,days);
  assert.equal(workbook.worksheets.length,1);
  assert.equal(sheet.getRow(14).hidden,true);
  assert.equal(sheet.getRow(65).hidden,true);
  assert.equal(sheet.pageSetup.orientation,'landscape');
  assert.equal(sheet.pageSetup.printArea,'A1:AN146');
  assert.equal(sheet.model.merges.length,257);
  for(const merge of ['G6:J6','N6:R6','G7:R7','AA7:AB7','AF7:AK7','G9:AE9']) assert.ok(sheet.model.merges.includes(merge),merge);
  assert.match(sheet.getCell('AF64').value.formula,/COUNTIF/);
  assert.match(sheet.getCell('AM128').value.formula,/IFERROR/);
});
test('official export still blocks unresolved days and conflicting same-period evidence',async()=>{
  const pending=await exportFixture({personal:false,pending:true});
  assert.equal(pending.res.code,409);
  const conflict=await exportFixture({personal:false,conflict:true});
  assert.equal(conflict.res.code,409);
});
