'use strict';
const ExcelJS = require('exceljs');

// Printed geometry from the supplied July/October reference, rebuilt from
// public form labels and measurements only. No original workbook, student
// identities, school branding, signatures, or reference attendance is shipped.
const LAYOUT = Object.freeze({ firstMale:13, firstFemale:64, capacity:50, maleTotal:63, femaleTotal:114, total:115, firstDate:7, dates:25, absent:32, present:33, summaryStart:37, rows:146 });
const widths=[4,51.54296875,5.81640625,5.81640625,5.81640625,5.81640625,...Array(25).fill(4.54296875),8.453125,9.6328125,9,7,6.54296875,6.81640625,7,6.54296875,4.81640625];
const heights={1:13.5,2:19.5,3:19.5,4:6.75,5:6.75,6:40.5,7:41.25,8:6,9:20.25,10:19.5,11:24.75,12:15,116:6.75,117:35.25,118:15,119:15.5,120:15.75,121:15.75,122:15.75,123:18,124:14.25,125:15.75,126:19.5,127:26.25,128:16.5,129:15.75,130:15.75,131:16.5,132:14.25,133:15.75,134:15.75,135:14.25,136:15,137:15.75,138:14.25,141:12,144:14.25,145:27.65,146:14.25};
const edge={style:'thin',color:{argb:'FF000000'}};
const border={top:edge,left:edge,bottom:edge,right:edge};
const pale={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F2F2'}};
const font=(size=11,bold=false,italic=false)=>({name:'Arial Narrow',size,bold,italic,color:{argb:'FF000000'}});
function formula(cell,expression,result,format='0.##'){
  cell.value={formula:expression,result};
  cell.numFmt=format;
}
// Monday–Friday reference positions (including blank leading/closure slots).
// For a personal weekend timetable, retain every date in chronological order.
function referenceDateSlots(month,dates){
  const slots=Array(25).fill(-1);
  const [y,m]=month.split('-').map(Number);
  let day=new Date(Date.UTC(y,m-1,1));
  let slot=[0,6].includes(day.getUTCDay())?0:day.getUTCDay()-1;
  const index=new Map(dates.map((date,i)=>[date,i]));
  let mapped=0;
  while(day.getUTCMonth()===m-1){
    if(![0,6].includes(day.getUTCDay())){
      const i=index.get(day.toISOString().slice(0,10));
      if(i!==undefined&&slot<25){slots[slot]=i;mapped++;}
      slot++;
    }
    day.setUTCDate(day.getUTCDate()+1);
  }
  if(mapped===dates.length)return {slots,weekly:true};
  return {slots:Array.from({length:25},(_,i)=>i<dates.length?i:-1),weekly:false};
}
function createReferenceWorkbook({source,data,summary,month,monthName,schoolName,schoolId,schoolYear,gradeLevel,section,personalCopy=false,adviserName='',schoolHeadName=''}){
  const wb=new ExcelJS.Workbook();
  const {slots,weekly}=referenceDateSlots(month,data.dates);
  wb.calcProperties.fullCalcOnLoad=true;
  const ws=wb.addWorksheet(personalCopy?'SF2 Subject Copy':'School Form 2 (SF2)',{
    views:[{showGridLines:false,zoomScale:80,activeCell:'A1'}],
    properties:{defaultRowHeight:14},
    pageSetup:{paperSize:9,orientation:'landscape',scale:62,fitToPage:false,printArea:'A1:AN146',printTitlesRow:'9:11',margins:{left:.17,right:.16,top:.18,bottom:.19,header:.17,footer:.16}}
  });
  widths.forEach((width,i)=>{const c=ws.getColumn(i+1);c.width=width;c.hidden=i>=2&&i<=5;});
  for(let row=1;row<=146;row++)ws.getRow(row).height=heights[row]??(row>=13&&row<=115?22:14);
  function put(address,value,{size=11,bold=false,italic=false,align='left',wrap=true,box=false,fill=false}={}){
    const c=ws.getCell(address);
    c.value=value;
    c.font=font(size,bold,italic);
    c.alignment={horizontal:align,vertical:'middle',wrapText:wrap};
    if(box)c.border=border;
    if(fill)c.fill=pale;
    return c;
  }
  function merge(range,value,style={}){ws.mergeCells(range);return put(range.split(':')[0],value,style);}
  const header={bold:true,size:12,align:'center',box:true};
  merge('A2:AM2',personalCopy?'School Form 2 (SF2) — Unofficial Subject Attendance Copy':'School Form 2 (SF2) Daily Attendance Report of Learners',{size:22,bold:true,align:'center',wrap:false});
  merge('A3:AM3',personalCopy?'Subject teacher record only — not certified daily attendance or an official submission.':'(This replaces Form 1, Form 2 & STS Form 4 - Absenteeism and Dropout Profile)',{size:12,italic:true,align:'center'});
  put('B6','School ID',{size:16,align:'right'});
  merge('G6:J6',schoolId,{size:16,align:'center',box:true});
  put('M6','School Year',{size:16,align:'right'});
  merge('N6:R6',schoolYear,{size:16,align:'center',box:true});
  merge('T6:Z6','Report for the  Month of',{size:16,align:'right'});
  merge('AA6:AF6',monthName,{size:16,align:'center',box:true});
  put('B7','Name of School',{size:16,align:'right'});
  merge('G7:R7',schoolName,{size:14,align:'center',box:true});
  merge('W7:Z7','Grade Level',{size:16,align:'right'});
  merge('AA7:AB7',gradeLevel,{size:14,align:'center',box:true});
  merge('AC7:AE7','Section',{size:16,align:'right'});
  merge('AF7:AK7',section,{size:14,align:'center',box:true});
  merge('A9:B11',"LEARNER'S NAME\n(Last Name, First Name, Middle Name)",{...header,size:16});
  merge('G9:AE9',personalCopy?'Dates / weekdays | P Present • L Late • X Subject absence • E Excused • NR Not recorded • — No class • ! Review':'(1st row for date, 2nd row for Day: M,T,W,TH,F)',{...header,size:personalCopy?10:12});
  merge('AF9:AG10','Total for the Month',header);
  merge('AF11:AF12',personalCopy?'SUBJECT ABSENT':'ABSENT',header);
  merge('AG11:AG12',personalCopy?'SUBJECT PRESENT':'PRESENT',header);
  merge('AH9:AM12','REMARKS (If NLS, state reason, please refer to legend number 2. If TRANSFERRED IN/OUT, write the name of School.)',header);
  for(let i=0;i<25;i++){
    const c=7+i,date=data.dates[slots[i]],d=date?new Date(date+'T00:00:00Z'):null;
    const day=ws.getCell(10,c),weekday=ws.getCell(11,c);
    put(day.address,d?d.getUTCDate():null,header);
    put(weekday.address,weekly?['M','T','W','TH','F'][i%5]:(d?['SU','M','T','W','TH','F','SA'][d.getUTCDay()]:null),header);
    weekday.alignment={horizontal:'center',vertical:'middle',textRotation:90};
    ws.getCell(12,c).border=border;
  }
  // Tardy counts are retained as an unprinted audit column because the
  // reference prints ABSENT/PRESENT, not ABSENT/TARDY. No loss of source data.
  ws.getColumn(41).width=12;
  ws.getColumn(41).hidden=true;
  put('AO12',personalCopy?null:'TARDY (recorded)');
  const groups=[data.students.filter(x=>String(x.sex).toUpperCase()==='MALE'),data.students.filter(x=>String(x.sex).toUpperCase()==='FEMALE')];
  const totals=[];
  const codes={PRESENT:'P',LATE:'L',SUBJECT_ABSENT:'X',EXCUSED:'E',NO_RECORD:'NR',NO_CLASS:'—',CONFLICT:'!'};
  groups.forEach((learners,g)=>{
    const start=g?64:13,end=start+49,total=g?114:63;
    const daily=Array(data.dates.length).fill(0),recorded=Array(data.dates.length).fill(false);
    let abs=0,pres=0,hasEvidence=false;
    for(let i=0;i<50;i++){
      const row=start+i,learner=learners[i];
      ws.getRow(row).hidden=!learner;
      put('A'+row,learner?i+1:null,{align:'center',box:true});
      put('B'+row,learner?learner.name:null,{box:true});
      let rowAbsent=0,rowPresent=0,rowEvidence=false;
      for(let slot=0;slot<25;slot++){
        const d=slots[slot];
        const status=learner&&d>=0?(personalCopy?(learner.subjectDays?.[d]||learner.days[d]):learner.days[d]):null;
        let value=null;
        if(personalCopy){
          value=codes[status]||null;
          if(['PRESENT','LATE','SUBJECT_ABSENT','EXCUSED'].includes(status)){recorded[d]=true;rowEvidence=true;}
          if(status==='PRESENT'||status==='LATE'){daily[d]++;rowPresent++;}
          if(status==='SUBJECT_ABSENT')rowAbsent++;
        }else if(status==='PRESENT'){daily[d]++;rowPresent++;rowEvidence=true;recorded[d]=true;}
        else if(status==='ABSENT'){value='X';rowAbsent++;rowEvidence=true;recorded[d]=true;}
        const cell=ws.getCell(row,7+slot);
        put(cell.address,value,{align:'center',size:status==='NO_RECORD'?9:11,box:true});
        // Reference July/October have no diagonal guide borders. Preserve
        // weekly separators without fabricating tardy or half-day evidence.
        if(weekly&&slot%5===0)cell.border={...border,left:{...edge,style:'medium'}};
        if(slot===24)cell.border={...cell.border,right:{...edge,style:'medium'}};
      }
      const a=put('AF'+row,null,{align:'center',bold:true,box:true,fill:true});
      const p=put('AG'+row,null,{align:'center',bold:true,box:true,fill:true});
      if(learner&&(!personalCopy||rowEvidence)){
        const range='G'+row+':AE'+row;
        formula(a,'COUNTIF('+range+',"X")'+(personalCopy?'':'+COUNTIF('+range+',"H")*0.5'),rowAbsent,'0.##');
        formula(p,personalCopy?'COUNTIF('+range+',"P")+COUNTIF('+range+',"L")':'$AJ$117-AF'+row,rowPresent,'0.##');
      }
      if(learner&&!personalCopy)put('AO'+row,Number(learner.tardyCount)||0,{align:'center'});
      merge('AH'+row+':AI'+row,null,{box:true,align:'center'});
      merge('AJ'+row+':AM'+row,null,{box:true});
      abs+=rowAbsent;pres+=rowPresent;hasEvidence=hasEvidence||rowEvidence;
    }
    merge('A'+total+':B'+total,g?'FEMALE  | TOTAL Per Day':'MALE  | TOTAL Per Day',{...header,fill:true});
    for(let slot=0;slot<25;slot++){
      const d=slots[slot],c=ws.getCell(total,7+slot),col=c.address.replace(/\d+$/,'');
      put(c.address,null,{...header,fill:true});
      if(d<0||(personalCopy&&!recorded[d]))continue;
      const range=col+start+':'+col+end;
      const expr=personalCopy?'COUNTIF('+range+',"P")+COUNTIF('+range+',"L")':'COUNTA($B$'+start+':$B$'+end+')-COUNTIF('+range+',"X")-COUNTIF('+range+',"H")*0.5';
      formula(c,expr,daily[d],'0.##');
    }
    for(const [col,result] of [['AF',abs],['AG',pres]]){
      const cell=put(col+total,null,{...header,fill:true});
      if(!personalCopy||hasEvidence)formula(cell,'SUM('+col+start+':'+col+end+')',result,'0.##');
    }
    merge('AH'+total+':AM'+total,null,{box:true,fill:true});
    totals.push({daily,recorded,abs,pres,hasEvidence});
  });
  merge('A115:B115','    Combined TOTAL PER DAY',{...header,fill:true});
  for(let slot=0;slot<25;slot++){
    const d=slots[slot],c=ws.getCell(115,7+slot),col=c.address.replace(/\d+$/,'');
    put(c.address,null,{...header,fill:true});
    if(d>=0&&(!personalCopy||totals.some(x=>x.recorded[d])))formula(c,'SUM('+col+'63,'+col+'114)',totals[0].daily[d]+totals[1].daily[d],'0.##');
  }
  for(const [col,key] of [['AF','abs'],['AG','pres']]){
    const cell=put(col+'115',null,{...header,fill:true});
    if(!personalCopy||totals.some(x=>x.hasEvidence))formula(cell,'SUM('+col+'63,'+col+'114)',totals[0][key]+totals[1][key],'0.##');
  }
  merge('AH115:AM115',null,{box:true,fill:true});
  // Use the clean DepEd template's static guideline wording, never a school
  // workbook's data. The reference uses the newer NLS caption.
  put('A117','GUIDELINES:',{bold:true,size:12});
  const guides=[['A118:Q118','A65'],['A119:Q119','A66'],['A120:Q120','A67'],['A128:Q129','A75'],['A130:R131','A77'],['A132:Q132','A79'],['B133:Q133','B80']];
  for(const [dest,src] of guides)merge(dest,personalCopy&&['A75','A77','A79'].includes(src)?null:source.getCell(src).value,{size:11});
  for(const [r,letter,label,numerator,denominator,multiply] of [[121,'a.','Percentage of Enrolment =','Registered Learner as of End of the Month','Enrolment as of 1st Friday of the SY',true],[123,'b.','Average Daily Attendance =','Total Daily Attendance','Number of School Days in reporting month',false],[125,'c.','Percentage of Attendance for the month =','Average daily attendance','Registered Learner as of End of the month',true]]){
    merge('A'+r+':A'+(r+1),letter);
    merge('B'+r+':B'+(r+1),label,{align:'right'});
    merge('G'+r+':P'+r,numerator,{align:'center',box:true});
    merge('G'+(r+1)+':P'+(r+1),denominator,{align:'center',box:true});
    if(multiply)merge('Q'+r+':R'+(r+1),'x 100',{align:'center'});
  }
  put('A133','*');
  put('T117','1. CODES FOR CHECKING ATTENDANCE',{bold:true,size:12});
  merge('T118:AB120',personalCopy?'P/L = recorded subject presence; X/E = confirmed subject absence/excused; NR = no conclusive record (not absent); — = no class; ! = conflict; blank = future or unused.':'blank- Present; (x)- Absent; Tardy (half shaded= Upper for Late Commer, Lower for Cutting Classes)',{box:true});
  put('T121','2. REASONS/CAUSES FOR NLS',{bold:true,size:12});
  for(let r=122;r<=146;r++){
    const val=source.getCell('Q'+(r-53)).value;
    if(typeof val==='string')put('T'+r,val,{size:11,wrap:false});
  }
  merge('AE117:AF118','Month:',header);
  merge('AG117:AG118',monthName,header);
  merge('AH117:AI118','No. of Days of Classes:',header);
  merge('AJ117:AJ118',personalCopy?null:summary.days,header);
  merge('AK117:AM117','Summary for the Month',header);
  ['AK','AL','AM'].forEach((c,i)=>put(c+'118',['M','F','TOTAL'][i],header));
  const metrics=[[119,'* Enrolment as of (1st Friday of the SY)','early'],[121,'Late Enrollment during the month (beyond cut-off)','late'],[123,'Registered Learner as of end of the month','registered'],[125,'Percentage of Enrolment as of end of the month','enrollmentRate'],[127,'Average Daily Attendance','average'],[128,'Percentage of Attendance for the month','attendanceRate'],[130,'Number of students with 5 consecutive days of absences:','consecutive'],[132,'NLS','dropout'],[134,'Transferred out','transferOut'],[136,'Transferred in','transferIn']];
  const m=summary?.male||{},f=summary?.female||{},combined={};
  for(const key of ['early','late','registered','presentDays','consecutive','dropout','transferOut','transferIn'])combined[key]=Number(m[key]||0)+Number(f[key]||0);
  const divide=(n,d)=>d?n/d:'N/A';
  for(const [r,label,key] of metrics){
    const end=r===127?r:r+1;
    merge('AE'+r+':AJ'+end,label,{box:true,italic:true,size:12});
    ['AK','AL','AM'].forEach((col,i)=>{
      const cell=end===r?put(col+r,null,{...header,fill:[125,127,128].includes(r)}):merge(col+r+':'+col+end,null,{...header,fill:[125,127,128].includes(r)});
      if(personalCopy)return;
      const values=[m,f,combined][i];
      if(key==='enrollmentRate')formula(cell,'IFERROR('+col+'123/'+col+'119,"N/A")',divide(values.registered,values.early),'0%');
      else if(key==='average')formula(cell,'IFERROR(AG'+[63,114,115][i]+'/$AJ$117,"N/A")',divide(values.presentDays,summary.days),'0.00');
      else if(key==='attendanceRate')formula(cell,'IFERROR('+col+'127/'+col+'123,"N/A")',divide(values.presentDays,values.registered*summary.days),'0%');
      else if(key==='registered'&&i<2)formula(cell,'COUNTA($B$'+[13,64][i]+':$B$'+[62,113][i]+')',values.registered,'0');
      else if(i===2)formula(cell,'SUM(AK'+r+':AL'+r+')',values[key],'0');
      else {cell.value=values[key];cell.numFmt='0';}
    });
  }
  put('AE139',personalCopy?'Unofficial — subject attendance only.':'I certify that this is a true and correct report.',{size:11,wrap:false});
  merge('AE140:AM141',personalCopy?null:(adviserName||null),{align:'center'});
  merge('AE142:AM142',personalCopy?'Not for official submission':'(Signature of Adviser over Printed Name)',{align:'center'});
  put('AE144',personalCopy?null:'Attested by:');
  merge('AE145:AM145',personalCopy?null:(schoolHeadName||null),{align:'center'});
  merge('AE146:AM146',personalCopy?null:'(Signature of School Head over Printed Name)',{align:'center'});
  return wb;
}
module.exports={createReferenceWorkbook,referenceDateSlots,LAYOUT};
