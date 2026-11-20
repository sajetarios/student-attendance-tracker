'use strict';

// Position-aware extraction for searchable DepEd SF1 PDFs. Unlike a line-based
// parser, this reconstructs learner fields from the physical table columns.
// Never infer a full LRN from an abbreviated/scientific-notation cell.
const {extractName,normalizeGuardianContact}=require('./sf1-import-parser');
const LRN=/^\d{12}$/;
const SCI=/^\d+(?:\.\d+)?e[+-]?\d+$/i;
const safeText=value=>String(value||'').replace(/\u00a0/g,' ').trim();
const isNameHeader=text=>/^\s*NAME(?:\s*\(|\s*$)/i.test(text);
const isSexHeader=text=>/^\s*(?:SEX|GENDER)(?:\s*\(|\s*$)/i.test(text);
const isBirthHeader=text=>/^\s*(?:BIRTH\s*DATE|DATE\s*OF\s*BIRTH|BIRTHDAY)(?:\s*\(|\s*$)/i.test(text);
const canonical=value=>safeText(value).replace(/\s+/g,'');
function itemsOnPage(page) {
 return (page.items||[]).filter(item=>typeof item.str==='string'&&item.str.trim()&&Array.isArray(item.transform))
  .map(item=>({x:Number(item.transform[4]),y:Number(item.transform[5]),text:safeText(item.str)}))
  .filter(item=>Number.isFinite(item.x)&&Number.isFinite(item.y));
}
function findColumns(items) {
 const lrn=items.find(item=>/^\s*LRN\s*$/i.test(item.text));
 if(!lrn)return null;
 const names=items.filter(item=>isNameHeader(item.text)&&item.x>lrn.x+5&&Math.abs(item.y-lrn.y)<45);
 for(const name of names){
  const sex=items.find(item=>isSexHeader(item.text)&&item.x>name.x+8&&Math.abs(item.y-name.y)<45);
  if(!sex)continue;
  const birth=items.filter(item=>isBirthHeader(item.text)&&item.x>sex.x+4&&Math.abs(item.y-sex.y)<45)
   .sort((a,b)=>a.x-b.x)[0];
  // Name, LRN and sex must occupy different physical columns.
  const nameMin=name.x-7,sexMin=sex.x-6;
  if(sexMin<=nameMin+8)continue;
  return {
   lrnMin:Math.max(0,lrn.x-60),lrnMax:nameMin-1,
   nameMin,nameMax:sexMin-1,sexMin,
   sexMax:birth?birth.x-2:sex.x+20,
   topY:Math.min(lrn.y,name.y,sex.y)-3
  };
 }
 return null;
}
function baselines(items) {
 const lines=[];
 for(const item of [...items].sort((a,b)=>b.y-a.y||a.x-b.x)){
  let line=lines.find(l=>Math.abs(l.y-item.y)<2.6);
  if(!line){line={y:item.y,items:[]};lines.push(line);}
  line.items.push(item);
 }
 for(const line of lines)line.items.sort((a,b)=>a.x-b.x);
 return lines.sort((a,b)=>b.y-a.y);
}
function columnText(line,min,max){
 return line.items.filter(item=>item.x>=min&&item.x<max).map(item=>item.text).join(' ').trim();
}
function readLayoutPages(pages,{gradeLevel='',schoolYear=''}={}){
 const learners=[],errors=[],seen=new Set();
 let columns=null,recognized=false,scientific=0,lrnCount=0;
 (pages||[]).forEach((page,pageIndex)=>{
  const items=itemsOnPage(page);
  const foundColumns=findColumns(items);
  if(foundColumns){columns=foundColumns;recognized=true;}
  if(!columns)return;
  const lines=baselines(items).filter(line=>!foundColumns||line.y<foundColumns.topY);
  const anchors=[];
  for(const line of lines){
   const raw=columnText(line,columns.lrnMin,columns.lrnMax);
   const token=canonical(raw);
   if(LRN.test(token)){anchors.push({line,lrn:token});lrnCount++;}
   else if(SCI.test(token)){anchors.push({line,scientific:true});scientific++;}
  }
  for(let i=0;i<anchors.length;i++){
   const anchor=anchors[i],next=anchors[i+1];
   if(anchor.scientific)continue;
   const startY=anchor.line.y+3;
   const endY=next?Math.max(next.line.y+2,anchor.line.y-95):anchor.line.y-95;
   const within=lines.filter(line=>line.y<=startY&&line.y>endY);
   // Avoid accidentally appending the summary/footer to the last learner.
   const meaningful=within.filter(line=>!/TOTAL\s+(?:MALE|FEMALE)|COMBINED|PREPARED\s+BY|CERTIFIED\s+CORRECT/i.test(line.items.map(x=>x.text).join(' ')));
   const nameParts=meaningful.map(line=>columnText(line,columns.nameMin,columns.nameMax)).filter(Boolean);
   const nameRaw=nameParts.join(' ').replace(/\s+/g,' ').trim();
   const sexTokens=meaningful.map(line=>columnText(line,columns.sexMin,columns.sexMax).toUpperCase())
    .filter(v=>/^(?:M|F|MALE|FEMALE)$/.test(v));
   const sex=sexTokens[0]==='M'||sexTokens[0]==='MALE'?'MALE':sexTokens[0]==='F'||sexTokens[0]==='FEMALE'?'FEMALE':'';
   if(!nameRaw.includes(',')||nameRaw.length>200||!sex){
    errors.push({rowNumber:i+1,pageNumber:pageIndex+1,message:'LRN '+anchor.lrn+': PDF row has an unreadable name or sex; verify the source workbook.'});
    continue;
   }
   if(seen.has(anchor.lrn)){
    errors.push({rowNumber:i+1,pageNumber:pageIndex+1,message:'Repeated learner LRN on multiple PDF rows.'});
    continue;
   }
   seen.add(anchor.lrn);
   learners.push({rowNumber:i+1,lrn:anchor.lrn,fullName:extractName(nameRaw),sex,gradeLevel,section:'Unassigned',studentId:'',parentName:'',parentMobile:''});
  }
 });
 if(!recognized||(!lrnCount&&!scientific))return null;
 if(scientific){
  throw Error('The PDF abbreviates '+scientific+' learner LRN(s) using scientific notation (for example 1.2938E+11). Missing LRN digits cannot be recovered safely. Export the original LIS .xls or .xlsx file with 12-digit LRNs and upload it instead.');
 }
 if(!learners.length)throw Error('The SF1 PDF table was recognized, but learner names or sex values could not be reconstructed safely. Use the original LIS Excel file.');
 if(learners.length>2000)throw Error('Import a maximum of 2,000 learners at once.');
 if(lrnCount!==learners.length)errors.push({rowNumber:0,message:'Some detected LRNs could not be reconstructed into complete learner records.'});
 return {learners,gradeLevel,schoolYear,errors};
}
module.exports={readLayoutPages};
