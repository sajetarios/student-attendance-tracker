'use strict';
const ExcelJS = require('exceljs');
const MAX_BYTES = 5 * 1024 * 1024;
const digits = value => String(value ?? '').replace(/\s/g, '');
const asText = value => {
 if (value == null) return '';
 if (typeof value === 'object') return String(value.text ?? value.result ?? value.richText?.map(x => x.text).join('') ?? '');
 return String(value);
};
const normalize = x => asText(x).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const gradeFromText = x => {
 const text=asText(x);
 const m = /grade\s*(?:level)?\s*[:\-]?\s*(1[0-2]|[1-9])\b/i.exec(text);
 return m ? 'Grade '+Number(m[1]) : '';
};
const extractName = name => {
 const text=asText(name).trim().replace(/\s+/g,' ');
 // DepEd SF1 prints names as LAST NAME, FIRST NAME, MIDDLE NAME.
 if (!text.includes(',')) return text;
 const parts=text.split(',').map(x=>x.trim()).filter(Boolean);
 return parts.length>1 ? [parts.slice(1).join(' '),parts[0]].join(' ').trim() : text;
};
function parseSf1Matrix(rows) {
 if (!Array.isArray(rows) || !rows.length) throw Error('The SF1 workbook has no readable rows.');
 let grade='',schoolYear='',headerIndex=-1,lrnCol=-1,nameCol=-1,sexCol=-1;
 const limit=Math.min(rows.length,65);
 for(let i=0;i<limit;i++){
  const row=rows[i].map(asText);
  const joined=row.join(' ');
  if(!grade) grade=gradeFromText(joined);
  if(!schoolYear) {const sy=joined.match(/(?:school\s*year|s\.?y\.?)\s*[:\-]?\s*((?:20\d{2})\s*[-–/]\s*(?:20)?\d{2,4})/i);if(sy)schoolYear=sy[1].replace(/\s/g,'');}
  const cols=row.map(normalize);
  const li=cols.findIndex(v=>v==='lrn'||v==='learnerreferencenumber');
  const ni=cols.findIndex(v=>v==='name'||v==='learnername'||v.startsWith('namelastname')||v==='nameoflearner');
  const si=cols.findIndex(v=>v==='sexmf'||v==='sex'||v==='gender');
  if(li>=0 && ni>=0 && li!==ni){headerIndex=i;lrnCol=li;nameCol=ni;sexCol=si;break;}
 }
 if(headerIndex<0) throw Error('The workbook does not show an identifiable SF1 LRN and NAME header. Export the official School Form 1 from LIS.');
 if(!grade) throw Error('Could not identify the SF1 grade level. Verify the School Form 1 header before importing.');
 const learners=[],errors=[];
 let currentSex='';
 for(let i=headerIndex+1;i<rows.length;i++){
  const row=rows[i].map(asText), rawLrn=digits(row[lrnCol]), rawName=asText(row[nameCol]).trim();
  const line=row.join(' ').trim();
  if(/^\s*(male|female)\s*$/i.test(rawName)){currentSex=rawName.toUpperCase();continue;}
  if(/^(?:total|prepared by|certified correct|school form|generated thru lis)/i.test(rawName))continue;
  if(!rawLrn && !rawName)continue;
  // Repeated header/footers and aggregate cells are never learner records.
  if(!/^\d{12}$/.test(rawLrn)){
   if(rawLrn && /\d/.test(rawLrn) && rawName && !/total|school|remarks/i.test(line))
    errors.push({rowNumber:i+1,message:'Invalid 12-digit LRN.'});
   continue;
  }
  const rawSex=asText(sexCol>=0?row[sexCol]:'').trim().toUpperCase();
  const sex=rawSex==='M'||rawSex==='MALE'?'MALE':rawSex==='F'||rawSex==='FEMALE'?'FEMALE':currentSex;
  if(!rawName || !['MALE','FEMALE'].includes(sex)){errors.push({rowNumber:i+1,message:'Learner name or sex is missing.'});continue;}
  learners.push({rowNumber:i+1,lrn:rawLrn,fullName:extractName(rawName),sex,gradeLevel:grade,section:'Unassigned',studentId:'',parentName:'',parentMobile:''});
 }
 if(!learners.length) throw Error('No valid SF1 learners were found. Check the LIS-exported workbook.');
 if(learners.length>2000) throw Error('Import a maximum of 2,000 learners at once.');
 return {learners,gradeLevel:grade,schoolYear,errors};
}
async function parseSf1Base64(base64) {
 if(typeof base64!=='string'||!base64.length)throw Error('Choose an SF1 Excel workbook.');
 const data=Buffer.from(base64,'base64');
 if(!data.length||data.length>MAX_BYTES)throw Error('The SF1 workbook must be 5 MB or smaller.');
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(data);
 const results=[];
 for(const sheet of workbook.worksheets){
  if(sheet.rowCount>4500)throw Error('The SF1 worksheet is too large.');
  const rows=[];
  sheet.eachRow({includeEmpty:true},(row,index)=>{
   const cells=[];for(let c=1;c<=Math.min(sheet.columnCount,55);c++)cells.push(asText(row.getCell(c).value));
   rows[index-1]=cells;
  });
  try {results.push(parseSf1Matrix(rows.map(r=>r||[])));}catch(e){if(/no valid SF1|does not show an identifiable|Could not identify/.test(e.message))continue;throw e;}
 }
 if(results.length!==1)throw Error(results.length?'Multiple SF1 roster worksheets detected. Upload one class SF1 workbook at a time.':'Could not detect an SF1 roster in this workbook.');
 return results[0];
}
module.exports={parseSf1Matrix,parseSf1Base64,extractName};