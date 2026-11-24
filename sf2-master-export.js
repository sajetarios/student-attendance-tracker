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
async function renderMasterWorkbook({calculated,data,month,personalCopy=false,schoolName,schoolId,schoolYear,gradeLevel,section,adviserName,schoolHeadName,templatePath=MASTER}){
  const zip=await JSZip.loadAsync(await fs.readFile(templatePath));
  const file='xl/worksheets/sheet1.xml';
  let sheet=await zip.file(file).async('string');
  if(!/<mergeCells count="257">/.test(sheet))throw new Error('Unexpected SF2 master geometry');
  const changes=new Map();
  const set=(address,value,gray=false)=>changes.set(address,{value,gray});
  const source=calculated.worksheets[0];
  const read=address=>{const c=source.getCell(address);return c.formula?{formula:c.formula,result:c.result}:c.value;};
  const copy=address=>set(address,read(address));
  const cache=(address,formula,result)=>set(address,{formula,result});
  const {slots}=referenceDateSlots(month,data.dates);
  const groups=[data.students.filter(x=>String(x.sex).toUpperCase()==='MALE'),data.students.filter(x=>String(x.sex).toUpperCase()==='FEMALE')];
  set('G6',schoolId||null);set('N6',schoolYear||null);copy('AA6');
  set('G7',schoolName||null);set('AA7',String(gradeLevel||'').replace(/^Grade\s+/i,''));set('AF7',section);
  if(personalCopy){
    set('A3','UNOFFICIAL SUBJECT ATTENDANCE COPY — Not for official submission');
    set('G9','White blank = present | Gray = no record | X = absent (subject only)');
    set('T118','White blank: Present; Gray: no record (not absent); X: Absent; L: Late; E: Excused; —: No class; !: Review.');
    for(const a of ['AE139','AE140','AE142','AE144','AE145','AE146'])set(a,null);
    set('AE142','Subject teacher reference only');
  }else{
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
          set(address,code==='P'||code==='NR'||code==='FUTURE'?null:code,code==='NR'||code==='FUTURE');
        }else copy(address);
      }
      // Both subject totals use the same verified evidence ledger. A visible
      // white or gray blank never creates a positive or negative record.
      const absence=read('AF'+row);
      if(personalCopy&&absence&&typeof absence==='object')cache('AF'+row,'COUNTIF(AU'+row+':BS'+row+',"X")',absence.result);
      else copy('AF'+row);
      const present=read('AG'+row);
      if(personalCopy&&present&&typeof present==='object')cache('AG'+row,'COUNTIF(AU'+row+':BS'+row+',"P")+COUNTIF(AU'+row+':BS'+row+',"L")',present.result);
      else copy('AG'+row);
      if(learner&&!personalCopy)addHelper(row,'BT'+row,Number(learner.tardyCount)||0);
    }
    for(let slot=0;slot<25;slot++){
      const address=col(7+slot)+total,v=read(address),c=col(47+slot);
      if(personalCopy&&v&&typeof v==='object')cache(address,'COUNTIF('+c+start+':'+c+end+',"P")+COUNTIF('+c+start+':'+c+end+',"L")',v.result);
      else copy(address);
    }
    copy('AF'+total);copy('AG'+total);
  }
  for(let slot=0;slot<25;slot++)copy(col(7+slot)+'115');
  copy('AF115');copy('AG115');cache('AG117','AA6',read('AA6'));
  // Calculate school days from the exported date headers instead of the
  // old editable AQ9 field. Blank holidays and unused slots never count.
  if(personalCopy)set('AJ117',null);else cache('AJ117','COUNT(G10:AE10)',data.dates.length);
  for(const r of [119,121,123,125,127,128,130,132,134,136])for(const c of ['AK','AL','AM'])copy(c+r);
  // Exact template cells only: preserve original style indices and all unrelated
  // elements. Gray uses a clone of each original style with only its fill changed.
  sheet=sheet.replace(/<c\b([^>]*\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(whole,attrs,address)=>{
    const patch=changes.get(address);
    if(!patch)return whole;
    changes.delete(address);
    let a=attrs.replace(/\s+t="[^"]*"/g,'');
    if(patch.gray){
      const m=a.match(/\bs="(\d+)"/);
      if(!m)throw new Error('Missing original grid style '+address);
      a=a.replace(/\bs="\d+"/,'s="'+(Number(m[1])+STYLE_OFFSET)+'"');
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
  zip.file(file,sheet);
  if(personalCopy){const p='xl/workbook.xml';const w=await zip.file(p).async('string');zip.file(p,w.replaceAll('School Form 2 (SF2)','SF2 Subject Copy'));}
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={renderMasterWorkbook,MASTER};
