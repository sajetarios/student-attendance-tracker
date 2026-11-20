'use strict';

// PDF input uses the same validated SF1 commit pipeline as Excel.
// Text-only parsing: reject unsupported/scanned layouts rather than guessing student data.
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
const {extractName,parseSf1Matrix}=require('./sf1-import-parser');
const MAX_BYTES=5*1024*1024, MAX_PAGES=30;
function gradeFromText(text){
 const m=String(text).match(/\bgrade\s*(?:level)?\s*[:\-]?\s*(1[0-2]|[1-9])\b/i);
 return m?'Grade '+Number(m[1]):'';
}
function parseSf1PdfText(text){
 const input=String(text||'').replace(/\u00a0/g,' ').replace(/\r/g,'');
 if(input.length<50)throw Error('The PDF has no selectable text. Upload the original LIS Excel SF1 or a searchable PDF.');
 if(!/(?:school\s*form\s*1|\bsf\s*1\b|school\s*register)/i.test(input)||!(/\bLRN\b/i.test(input))||!/\bNAME\b/i.test(input))
  throw Error('This PDF does not appear to contain a DepEd SF1 School Register with LRN and NAME columns.');
 const gradeLevel=gradeFromText(input.slice(0,12000));
 if(!gradeLevel)throw Error('Could not reliably detect the grade level from the SF1 PDF.');
 const sy=input.match(/(?:school\s*year|s\.?y\.?)\s*[:\-]?\s*((?:20\d{2})\s*[-–/]\s*(?:20)?\d{2,4})/i);
 const schoolYear=sy?sy[1].replace(/\s/g,''):'';
 const lines=input.split(/\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
 // A searchable PDF with explicit cell separators can be treated as a table.
 // For free-flow PDF text do NOT guess where address stops and guardian begins.
 const tableHeader=lines.find(line=>line.includes('|') && /\bLRN\b/i.test(line) && /\bNAME\b/i.test(line));
 if(tableHeader){
  const matrix=lines.map(line=>line.includes('|')?line.split(/\s*\|\s*/):[line]);
  return parseSf1Matrix(matrix);
 }
 const rows=[],errors=[],found=new Set();
 let currentSex='';
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^male(?:\s+learners)?$/i.test(line)){currentSex='MALE';continue;}
  if(/^female(?:\s+learners)?$/i.test(line)){currentSex='FEMALE';continue;}
  // Row number (optional), then LRN, then LAST, FIRST, MIDDLE and a sex value.
  const match=line.match(/^(?:\d{1,3}\s+)?(\d{12})\s+(.+)$/);
  if(!match)continue;
  const lrn=match[1];
  if(found.has(lrn)){errors.push({rowNumber:i+1,message:'Duplicate LRN in the PDF.'});continue;}
  found.add(lrn);
  const cells=match[2].trim().split(/\s+/);
  // Text PDFs often expose the M/F column after the name, before addresses and other columns.
  // Require the sex marker as a separate token near the learner name, not an inferred value.
  const sexIndex=cells.findIndex((c,k)=>k>0&&/^(M|F|MALE|FEMALE)$/i.test(c));
  if(sexIndex<0 && !currentSex){
   errors.push({rowNumber:i+1,message:'Cannot reliably identify learner sex on this PDF line. Use LIS Excel SF1.'});continue;
  }
  const sexToken=sexIndex>=0?cells[sexIndex].toUpperCase():currentSex;
  const sex=sexToken==='M'||sexToken==='MALE'?'MALE':'FEMALE';
  const fullName=extractName(cells.slice(0,sexIndex>=0?sexIndex:cells.length).join(' '));
  // No speculative names: an SF1 name must contain a comma, as in LAST, FIRST, MIDDLE.
  if(!/[,]/.test(cells.slice(0,sexIndex>=0?sexIndex:cells.length).join(' '))||fullName.length<3||fullName.length>200){
   errors.push({rowNumber:i+1,message:'Learner name could not be read reliably from this PDF. Use LIS Excel SF1.'});continue;
  }
  rows.push({rowNumber:i+1,lrn,fullName,sex,gradeLevel,section:'Unassigned',studentId:'',parentName:'',parentMobile:''});
 }
 // Match all 12-digit LRNs in the document to avoid silently dropping students.
 const expected=new Set([...input.matchAll(/\b\d{12}\b/g)].map(m=>m[0]));
 const missing=[...expected].filter(lrn=>!found.has(lrn));
 if(missing.length)errors.push({rowNumber:0,message:missing.length+' 12-digit LRN(s) could not be placed into validated SF1 rows.'});
 if(!rows.length)throw Error('No complete SF1 learner rows were found in the PDF. Use the original LIS Excel workbook if this PDF is scanned or its table is fragmented.');
 if(rows.length>2000)throw Error('Import a maximum of 2,000 learners at once.');
 return {learners:rows,gradeLevel,schoolYear,errors};
}
async function parseSf1PdfBase64(base64){
 if(typeof base64!=='string'||!base64.length)throw Error('Choose an SF1 PDF.');
 const data=Buffer.from(base64,'base64');
 if(data.length<8||data.length>MAX_BYTES||data.subarray(0,5).toString('ascii')!=='%PDF-')
  throw Error('Choose a valid PDF no larger than 5 MB.');
 let loadingTask,doc;
 try{
  loadingTask=pdfjs.getDocument({data:new Uint8Array(data),disableFontFace:true,useSystemFonts:true,isEvalSupported:false,enableScripting:false,stopAtErrors:true});
  doc=await loadingTask.promise;
  if(doc.numPages>MAX_PAGES)throw Error('SF1 PDF must contain at most 30 pages.');
  const pages=[];
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
   const page=await doc.getPage(pageNo);
   const content=await page.getTextContent();
   const grouped=[];
   for(const item of content.items){
    if(typeof item.str!=='string'||!item.str.trim())continue;
    const y=Number(item.transform?.[5]||0),x=Number(item.transform?.[4]||0);
    let line=grouped.find(row=>Math.abs(row.y-y)<2.8);
    if(!line){line={y,items:[]};grouped.push(line);}
    line.items.push({x,text:item.str});
   }
   grouped.sort((a,b)=>b.y-a.y);
   pages.push(grouped.map(row=>row.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ')).join('\n'));
  }
  return parseSf1PdfText(pages.join('\n'));
 }catch(e){
  if(/SF1 PDF must contain|The PDF has no selectable text|does not appear to contain|Could not reliably detect|No complete SF1 learner rows|maximum of 2,000/.test(e.message))throw e;
  throw Error('Could not safely read PDF text. Upload a searchable SF1 PDF or the original LIS Excel workbook.');
 }finally{
  if(loadingTask)await loadingTask.destroy().catch(()=>{});
 }
}
module.exports={parseSf1PdfText,parseSf1PdfBase64};
