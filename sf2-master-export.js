'use strict';
// Preserve the actual sanitized TUVERA OOXML package, not an ExcelJS
// re-serialization (which can drop drawings, original styles and print setup).
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require(require.resolve('jszip',{paths:[require.resolve('exceljs')]}));
const {referenceDateSlots}=require('./sf2-reference-workbook');
const MASTER=path.join(__dirname,'templates','Attendigo_SF2_Master.xlsx');
const STYLE_OFFSET=259; // Original style count in the sanitized JUL master.
const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function col(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
const rowNumbers=[...Array.from({length:50},(_,i)=>13+i),...Array.from({length:50},(_,i)=>64+i)];
function encode(v){
  if(v==null)return {type:'',body:''};
  if(typeof v==='number'&&Number.isFinite(v))return {type:'',body:'<v>'+v+'</v>'};
  if(typeof v==='object'&&typeof v.formula==='string'){
    const n=v.result;
    const kind=typeof n==='string'?'str':'';
    return {type:kind,body:'<f>'+xml(v.formula)+'</f>'+(n==null?'':'<v>'+xml(n)+'</v>')};
  }
  return {type:'inlineStr',body:'<is><t xml:space="preserve">'+xml(v)+'</t></is>'};
}
async function renderMasterWorkbook({calculated,data,summary,month,personalCopy=false,schoolName,schoolId,schoolYear,gradeLevel,section,adviserName,schoolHeadName,templatePath=MASTER}){
  const zip=await JSZip.loadAsync(await fs.readFile(templatePath));
  const file='xl/worksheets/sheet1.xml';
  let sheet=await zip.file(file).async('string');
  if(!/<mergeCells count="257">/.test(sheet))throw new Error('Unexpected SF2 master geometry');
  const changes=new Map();
  const set=(address,value,shade=null,format=null)=>changes.set(address,{value,shade,format});
  const source=calculated.worksheets[0];
  const read=address=>{const c=source.getCell(address);return c.formula?{formula:c.formula,result:c.result}:c.value;};
  const copy=address=>set(address,read(address));
  const cache=(address,formula,result,format=null)=>set(address,{formula,result},null,format);
  const {slots}=referenceDateSlots(month,data.dates);
  const groups=[data.students.filter(x=>String(x.sex).toUpperCase()==='MALE'),data.students.filter(x=>String(x.sex).toUpperCase()==='FEMALE')];
  set('G6',schoolId||null);set('N6',schoolYear||null);copy('AA6');
  set('G7',schoolName||null);set('AA7',String(gradeLevel||'').replace(/^Grade\s+/i,''));set('AF7',section);
  if(personalCopy){
    set('A2','Subject Attendance Report');
    set('A3','UNOFFICIAL — '+(data.subject?.label||'Selected subject')+' — Not for official submission');
    set('G9','White blank = present | Gray = no record | X = absent (subject only)');
    set('T118','White blank: Present; Gray: no record (not absent); X: Absent; Upper half shaded: Late; E: Excused; —: No class; !: Review.');
    for(const a of ['AE139','AE140','AE142','AE144','AE145','AE146'])set(a,null);
    set('AE142','Subject teacher reference only');
    // Preserve the original summary table and its printed labels. Only the
    // subject-copy guidance distinguishes the supporting attendance basis.
    set('A117','SUBJECT REPORT GUIDE:');
    set('A118','1. Only the selected subject is included. Not for official submission.');
    set('A119','2. Present includes late arrivals; X and E are confirmed absences.');
    set('A120','3. Class days follow the elapsed timetable and calendar; averages use fully recorded class days.');
    set('A130','Enrollment and movement figures come from the section records. Consecutive absences refer to this subject.');
    set('A132','No recorded complete class day: attendance averages and percentages are N/A.');

  }else{
    // This locally prepared worksheet supports completing the actual LIS form;
    // it is not represented as an authorized DepEd/LIS-issued electronic form.
    set('A2','SF2 Preparation Worksheet');
    set('A3','Supporting daily attendance record — Verify against the school’s LIS-issued SF2');
    set('AE139','Prepared for school verification');
    set('AE140',adviserName||null);set('AE145',schoolHeadName||null);
  }
  // The old manual calculation panel is obsolete. Its visible labels and
  // input are not part of the printable SF2 and must not appear in either export.
  for(const address of ['AO6','AO9','AQ9','AO13','AO14','AP14','AO15','AP15','AO16','AP16','AO18','AP18'])set(address,null);
  for(let i=0;i<25;i++){copy(col(7+i)+'10');copy(col(7+i)+'11');}
  const helper=new Map();
  const addHelper=(row,address,value)=>{if(!helper.has(row))helper.set(row,[]);const v=encode(value);helper.get(row).push('<c r="'+address+'"'+(v.type?' t="'+v.type+'"':'')+'>'+v.body+'</c>');};
  const active=new Set();
  for(let g=0;g<2;g++){
    const start=g?64:13,end=start+49,total=g?114:63;
    for(let i=0;i<50;i++){
      const row=start+i,learner=groups[g][i];
      if(learner)active.add(row);
      copy('A'+row);copy('B'+row);
      for(let slot=0;slot<25;slot++){
        const d=slots[slot],address=col(7+slot)+row;
        if(!learner||d<0){set(address,null);continue;}
        const status=personalCopy?(learner.subjectDays?.[d]||learner.days[d]):learner.days[d];
        if(personalCopy){
          const code={PRESENT:'P',LATE:'L',SUBJECT_ABSENT:'X',EXCUSED:'E',NO_RECORD:'NR',NO_CLASS:'—',CONFLICT:'!',FUTURE:'FUTURE'}[status]||'NR';
          addHelper(row,col(47+slot)+row,code);
          set(address,['P','L','NR','FUTURE'].includes(code)?null:code,code==='L'?'late':code==='NR'||code==='FUTURE'?'gray':null);
        }else if(status==='PRESENT'&&learner.lateDays?.[d]===true)set(address,null,'late');
        else copy(address);
      }
      // Both subject totals use the same verified evidence ledger. A visible
      // white or gray blank never creates a positive or negative record.
      const absence=read('AF'+row);
      if(personalCopy&&absence&&typeof absence==='object')cache('AF'+row,'COUNTIF(AU'+row+':BS'+row+',"X")',absence.result);
      else copy('AF'+row);
      const present=read('AG'+row);
      if(personalCopy&&present&&typeof present==='object')cache('AG'+row,'COUNTIF(AU'+row+':BS'+row+',"P")+COUNTIF(AU'+row+':BS'+row+',"L")',present.result);
      else copy('AG'+row);
      if(learner&&!personalCopy){
        const tardy=Array.isArray(learner.lateDays)?learner.lateDays.filter(Boolean).length:0;
        addHelper(row,'BT'+row,tardy);
        // The TUVERA layout uses ABSENT/PRESENT. Retain the proven attendance
        // totals and also surface the verified tardy count for LIS preparation.
        set('AH'+row,tardy?'Tardy: '+tardy:null);
      }
    }
    for(let slot=0;slot<25;slot++){
      const address=col(7+slot)+total,v=read(address),c=col(47+slot);
      if(personalCopy&&v&&typeof v==='object')cache(address,'COUNTIF('+c+start+':'+c+end+',"P")+COUNTIF('+c+start+':'+c+end+',"L")',v.result);
      else copy(address);
    }
    copy('AF'+total);copy('AG'+total);
  }
  for(let slot=0;slot<25;slot++)copy(col(7+slot)+'115');
  copy('AF115');copy('AG115');
  // Keep the original full month name. Shrink text to fit only where needed;
  // the original column widths, row heights, merges and printed area remain.
  cache('AG117','AA6',read('AA6'),'month');
  if(personalCopy){
    const complete=summary?.completeSubjectDates||[];
    const days=complete.filter(Boolean).length;
    const classDates=data.subjectClassDates||complete;
    const classDays=classDates.filter(Boolean).length;
    // Preserve the original guidelines merge and clear the provisional note
    // when all elapsed class days are complete and the timetable is known.
    const incomplete=days<classDays;
    const uncertain=data.subjectScheduleUncertain===true;
    set('A128',incomplete||uncertain?`Provisional: ${days} of ${classDays} class days fully recorded.${uncertain?' Schedule needs review.':''}`:null);
    // The 25 hidden evidence slots in row 115 identify complete roster-days.
    // Row 114 separately identifies elapsed class dates.
    // They do not alter the visible attendance ledger, including partial days.
    for(let slot=0;slot<25;slot++){
      const d=slots[slot],hc=col(47+slot);
      addHelper(114,hc+'114',d>=0&&classDates[d]?1:0);
      addHelper(115,hc+'115',d>=0&&complete[d]?1:0);
    }
    cache('AJ117','SUM(AU114:BS114)',classDays);
    for(const r of [119,121,123,125,127,128,130,132,134,136]){
      for(const [i,c] of ['AK','AL','AM'].entries()){
        const v=read(c+r);
        if(r===127){
          const row=[63,114,115][i];
          const result=typeof v==='object'?v.result:v;
          cache(c+r,'IFERROR(SUMPRODUCT(G'+row+':AE'+row+',AU115:BS115)/SUM(AU115:BS115),"N/A")',result,'decimal');
        }else if(r===125||r===128){
          if(v&&typeof v==='object'&&v.formula)cache(c+r,v.formula,v.result,'percent');
          else set(c+r,v,null,'percent');
        }else copy(c+r);
      }
    }
  }else{
    cache('AJ117','COUNT(G10:AE10)',data.dates.length);
    for(const r of [119,121,123,125,127,128,130,132,134,136])for(const c of ['AK','AL','AM'])copy(c+r);
  }
  // Original style geometry is immutable. Add a single hard-stop gradient for
  // verified late arrivals and clone only the original grid styles that use it.
  // No inferred cutting-class or half-day absence marking is introduced.
  const styleFile='xl/styles.xml';
  let styles=await zip.file(styleFile).async('string');
  const xfBlock=styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  const fillBlock=styles.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
  if(!xfBlock||!fillBlock)throw Error('Unexpected SF2 master styles');
  const originals=[...xfBlock[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m=>m[0]);
  if(originals.length!==Number(xfBlock[1]))throw Error('Invalid SF2 master style count');
  const lateFill=Number(fillBlock[1]);
  const lateStyles=new Map();
  const numberStyles=new Map();
  const styleForLate=id=>{
    if(lateStyles.has(id))return lateStyles.get(id).id;
    const base=originals[id];
    if(!base)throw Error('Missing SF2 grid style '+id);
    let xf=base.replace(/\bfillId="\d+"/,'fillId="'+lateFill+'"');
    if(/\bapplyFill="/.test(xf))xf=xf.replace(/\bapplyFill="[^"]*"/,'applyFill="1"');
    else xf=xf.replace(/<xf\b/,'<xf applyFill="1"');
    const next=originals.length+lateStyles.size+numberStyles.size;
    lateStyles.set(id,{id:next,xf});
    return next;
  };
  const styleForNumber=(id,format)=>{
    const key=id+':'+format;
    if(numberStyles.has(key))return numberStyles.get(key).id;
    const base=originals[id];
    if(!base)throw Error('Missing SF2 summary style '+id);
    let xf=base.replace(/\bnumFmtId="\d+"/,'numFmtId="'+(format==='percent'?9:format==='decimal'?2:0)+'"');
    if(format==='month'||format==='percent'||format==='decimal'){
      // Shrink displayed text inside existing narrow cells; never resize the sheet.
      if(/<alignment\b/.test(xf))xf=xf.replace(/<alignment\b([^>]*?)(\/?>)/,(_,attrs,end)=>'<alignment'+attrs.replace(/\s+wrapText="[^"]*"/g,'').replace(/\s+shrinkToFit="[^"]*"/g,'')+' wrapText="0" shrinkToFit="1"'+end);
    }
    if(/\bapplyNumberFormat="/.test(xf))xf=xf.replace(/\bapplyNumberFormat="[^"]*"/,'applyNumberFormat="1"');
    else xf=xf.replace(/<xf\b/,'<xf applyNumberFormat="1"');
    const next=originals.length+lateStyles.size+numberStyles.size;
    numberStyles.set(key,{id:next,xf});
    return next;
  };
  // Exact template cells only: preserve original style indices and all unrelated elements.
  sheet=sheet.replace(/<c\b([^>]*\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(whole,attrs,address)=>{
    const patch=changes.get(address);
    if(!patch)return whole;
    changes.delete(address);
    let a=attrs.replace(/\s+t="[^"]*"/g,'');
    if(patch.shade||patch.format){
      const m=a.match(/\bs="(\d+)"/);
      if(!m)throw new Error('Missing original grid style '+address);
      const id=Number(m[1]);
      a=a.replace(/\bs="\d+"/,'s="'+(patch.format?styleForNumber(id,patch.format):patch.shade==='late'?styleForLate(id):id+STYLE_OFFSET)+'"');
    }
    const v=encode(patch.value);
    return '<c'+a+(v.type?' t="'+v.type+'"':'')+'>'+v.body+'</c>';
  });
  if(changes.size)throw new Error('SF2 master cells missing: '+[...changes.keys()].slice(0,8).join(', '));
  const slotsSet=new Set(rowNumbers);
  sheet=sheet.replace(/<row\b([^>]*\br="(\d+)"[^>]*)>([\s\S]*?)<\/row>/g,(whole,attrs,n,body)=>{
    const row=Number(n);let a=attrs;
    if(slotsSet.has(row)){a=a.replace(/\s+hidden="[^"]*"/g,'');if(!active.has(row))a+=' hidden="1"';}
    if(helper.has(row))a=a.replace(/\bspans="[^"]*"/,'spans="1:72"');
    return '<row'+a+'>'+body+(helper.get(row)||[]).join('')+'</row>';
  });
  // Hide the entire legacy side panel and the evidence ledger (AO:BT).
  // The original printable area A:AN and its column widths remain untouched.
  sheet=sheet.replace(/<col\b([^>]*?)\/>/g,(whole,attrs)=>{
    const min=Number(attrs.match(/\bmin="(\d+)"/)?.[1]),max=Number(attrs.match(/\bmax="(\d+)"/)?.[1]);
    if(min<41||min>72)return whole;
    const hidden=attrs.replace(/\s+hidden="[^"]*"/g,'').replace(/\bmax="\d+"/,'max="'+Math.min(max,72)+'"')+' hidden="1"';
    const remainder=max>72?'<col'+attrs.replace(/\bmin="\d+"/,'min="73"')+'/>':'';
    return '<col'+hidden+'/>'+remainder;
  });
  const covered=new Set();
  for(const m of sheet.matchAll(/<col\b([^>]*?)\/>/g)){
    const a=m[1],min=Number(a.match(/\bmin="(\d+)"/)?.[1]),max=Number(a.match(/\bmax="(\d+)"/)?.[1]);
    if(/\bhidden="1"/.test(a))for(let n=Math.max(min,41);n<=Math.min(max,72);n++)covered.add(n);
  }
  if(covered.size!==32)throw new Error('SF2 nonprinted helper columns are not fully hidden');
  sheet=sheet.replace(/<dimension ref="[^"]*"\/>/,'<dimension ref="A1:BT146"/>');
  if(lateStyles.size){
    const gradient='<fill><gradientFill degree="90"><stop position="0"><color rgb="FF000000"/></stop><stop position="0.499"><color rgb="FF000000"/></stop><stop position="0.5"><color rgb="FFFFFFFF"/></stop><stop position="1"><color rgb="FFFFFFFF"/></stop></gradientFill></fill>';
    styles=styles.replace(fillBlock[0],()=>'<fills count="'+(lateFill+1)+'">'+fillBlock[2]+gradient+'</fills>');
  }
  const extraStyles=[...lateStyles.values(),...numberStyles.values()].sort((a,b)=>a.id-b.id);
  if(extraStyles.length){
    styles=styles.replace(xfBlock[0],()=>'<cellXfs count="'+(originals.length+extraStyles.length)+'">'+xfBlock[2]+extraStyles.map(x=>x.xf).join('')+'</cellXfs>');
    zip.file(styleFile,styles);
  }
  zip.file(file,sheet);
  if(personalCopy){const p='xl/workbook.xml';const w=await zip.file(p).async('string');zip.file(p,w.replaceAll('School Form 2 (SF2)','SF2 Subject Copy'));}
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={renderMasterWorkbook,MASTER};
