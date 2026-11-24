'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const register=require('../sf2-routes');
// Aggregate benchmarks and de-identified absence patterns from the July/October
// reconciliation reports. Rows sorted independently by absence pattern; no
// names, IDs, school identifiers, original row order or real records are included.
const benchmarks=[{"month":"2026-07","days":23,"groups":[[[],[],[7,8]],[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[10],[13],[27,28,29],[28],[29]]],"present":[67,568],"absent":9,"daily":[28,28,28,28,27,27,28,27,27,28,28,28,28,28,28,28,28,28,27,26,26,28,28]},{"month":"2026-10","days":22,"groups":[[[],[23],[23]],[[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[12],[16],[19,28],[19,28],[20],[5],[5,19],[7,13,14]]],"present":[64,537],"absent":15}];
const result=rows=>({rows,rowCount:rows.length});
// ExcelJS cell.value copies formula metadata using truthiness; cell.result retains numeric zero.
const value = cell => cell.formula ? cell.result : cell.value;
function weekdays(month) {
  const [y,m]=month.split('-').map(Number);
  return Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>new Date(Date.UTC(y,m-1,i+1)))
    .filter(d=>![0,6].includes(d.getUTCDay())).map(d=>d.toISOString().slice(0,10));
}
for(const b of benchmarks) test('SF2 reconciled benchmark '+b.month+' actual XLSX round trip',async()=>{
  const dates=weekdays(b.month);
  assert.equal(dates.length,b.days);
  const {slots}=require('../sf2-reference-workbook').referenceDateSlots(b.month,dates);
  const col=d=>7+slots.indexOf(d);
  const roster=b.groups.flatMap((group,g)=>group.map((absence,i)=>({id:g+'-'+i,name:'LEARNER '+g+'-'+String(i).padStart(2,'0'),sex:g===0?'MALE':'FEMALE',absence})));
  const present=[],absent=[];
  for(const learner of roster) for(const date of dates) {
    const mark={id:learner.id,date};
    if(learner.absence.includes(Number(date.slice(-2)))) absent.push({...mark,absenceType:'UNEXCUSED'});
    else present.push(mark);
  }
  const pool={query:async sql=>{
    if(sql.includes('ALTER TABLE students'))return result([]);
    if(sql.includes('SELECT s.student_id AS id,s.full_name'))return result(roster);
    if(sql.includes('FROM manual_attendance_marks m'))return result([]);
    if(sql.includes('SELECT DISTINCT e.student_id AS id')&&sql.includes('FROM attendance_events'))return result(present);
    if(sql.includes('FROM sf2_daily_overrides o'))return result(absent);
    if(sql.includes('COUNT(DISTINCT e.school_date)'))return result([]);
    if(sql.includes('FROM school_calendar_exceptions'))return result([]);
    if(sql.includes("SELECT 'ADVISER' AS kind"))return result([{kind:'ADVISER',name:'TEST ADVISER'},{kind:'HEAD',name:'TEST HEAD'}]);
    if(sql.includes('FROM school_settings'))return result([{setting_key:'school_name',setting_value:'TEST SCHOOL'}]);
    if(sql.includes('SELECT start_date FROM school_years'))return result([{start_date:'2026-06-01'}]);
    // October reference correction confirmed by the user: beginning enrollment was
    // incorrectly entered as 40; the correct total is 28 (3 male, 25 female).
    // This synthetic fixture models that corrected baseline, not a production data edit.
    if(sql.includes('FROM student_enrollments e JOIN school_years sy'))return result(roster.map(x=>({sex:x.sex,student_id:x.id,enrollmentDate:'2026-06-01'})));
    if(sql.includes('FROM student_movements m'))return result([]);
    throw Error('Unexpected SQL: '+sql);
  }};
  const routes={},app={};
  for(const method of ['get','post','put','delete','patch'])app[method]=(url,...handlers)=>{routes[method+url]=handlers.at(-1);};
  const noop=()=>{};
  register(app,pool,{authenticateSchoolClient:noop,requireSchoolUser:noop,requireSchoolAdmin:noop,requireSchoolAdminOrDepartmentHead:noop});
  const req={auth:{schoolId:'fixture',userId:'fixture',role:'SCHOOL_ADMIN'},query:{month:b.month,gradeLevel:'8',section:'FIXTURE',mode:'OFFICIAL'}};
  const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(bytes){this.bytes=bytes;return this;}};
  await routes['get/api/sf2/export'](req,res);
  assert.equal(res.code,200,JSON.stringify(res.body));
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(res.bytes);
  const sheet=wb.worksheets[0];
  assert.equal(sheet.name,'School Form 2 (SF2)');
  assert.equal(sheet.getCell('AJ117').value,b.days);
  assert.equal(sheet.getCell(b.month.endsWith('-07')?'I10':'J10').value,1);
  assert.equal(sheet.getCell('G10').value,null);
  assert.equal(sheet.getCell('H10').value,null);
  if(b.month.endsWith('-10'))assert.equal(sheet.getCell('I10').value,null);
  let rowSum=[0,0],totalAbsent=0;
  for(let g=0;g<2;g++){
    const group=roster.filter(x=>x.sex===(g===0?'MALE':'FEMALE'));
    for(let i=0;i<group.length;i++){
      const row=(g===0?13:64)+i, learner=group[i];
      assert.equal(sheet.getCell(row,2).value,learner.name);
      assert.equal(value(sheet.getCell(row,32)),learner.absence.length);
      assert.equal(value(sheet.getCell(row,33)),b.days-learner.absence.length);
      for(let d=0;d<dates.length;d++){
        const missing=learner.absence.includes(Number(dates[d].slice(-2)));
        assert.equal(sheet.getCell(row,col(d)).value,missing?'X':null);
        if(missing)totalAbsent++;else rowSum[g]++;
      }
    }
  }
  assert.deepEqual(rowSum,b.present);
  assert.equal(totalAbsent,b.absent);
  assert.equal(value(sheet.getCell('AF115')),b.absent);
  assert.equal(value(sheet.getCell('AG115')),b.present[0]+b.present[1]);
  assert.equal(wb.worksheets.length,1);
  for(let d=0;d<dates.length;d++){
    const bySex=[0,1].map(g=>roster.filter(x=>x.sex===(g===0?'MALE':'FEMALE')&&!x.absence.includes(Number(dates[d].slice(-2)))).length);
    assert.equal(value(sheet.getCell(63,col(d))),bySex[0]);
    assert.equal(value(sheet.getCell(114,col(d))),bySex[1]);
    assert.equal(value(sheet.getCell(115,col(d))),bySex[0]+bySex[1]);
    if(b.daily)assert.equal(value(sheet.getCell(115,col(d))),b.daily[d]);
  }
  const total=b.present[0]+b.present[1];
  for(const [i,n,denom] of [[37,b.present[0],3],[38,b.present[1],25],[39,total,28]]){
    const cell=(r)=>{const c=sheet.getCell(r,i);return value(c.isMerged?c.master:c);};
    assert.equal(cell(119),denom); // Beginning enrollment: corrected reference
    assert.equal(cell(121),0); // No late enrollment in this fixture
    assert.equal(cell(123),denom);
    assert.equal(cell(125),1); // Corrected enrollment percentage
    assert.ok(Math.abs(Number(cell(127))-n/b.days)<1e-10);
    assert.ok(Math.abs(cell(128)-n/(denom*b.days))<1e-10);
    assert.equal(cell(130),0);
  }
});
