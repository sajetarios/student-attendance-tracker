'use strict';
const ExcelJS = require('exceljs');
const XLSX = require('@stackline/xlsx'); // Supports the native BIFF8 .xls exported by DepEd LIS.
const MAX_BYTES = 5 * 1024 * 1024;
const digits = value => String(value ?? '').replace(/\s/g, '');
const asText = value => {
 if (value == null) return '';
 if (typeof value === 'object') return String(value.text ?? value.result ?? value.richText?.map(x => x.text).join('') ?? '');
 return String(value);
};
const normalize = x => asText(x).trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const blank = x => /^(?:|n\/?a|none|notavailable|[-—])$/i.test(asText(x).trim());
function normalizeGuardianContact(value) {
 const raw=asText(value).trim();
 if(blank(raw))return '';
 if(!/^\+?[\d ().-]+$/.test(raw))return null;
 const number=raw.replace(/\D/g,'');
 if(number.length<7||number.length>15)return null;
 if(/^63(9\d{9})$/.test(number))return '0'+number.slice(2);
 if(/^9\d{9}$/.test(number))return '0'+number;
 return number;
}
// Only import values from explicitly labelled source columns. Do not infer
// a guardian's name from nearby names or a contact from arbitrary numbers.
function findOptionalColumn(rows, headerIndex, matcher) {
 const indices=new Set();
 for(let row=headerIndex;row<Math.min(rows.length,headerIndex+3);row++){
  rows[row].map(normalize).forEach((label,index)=>{if(matcher(label))indices.add(index);});
 }
 return indices.size===1?[...indices][0]:-1;
}
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
 let grade='',schoolYear='',headerIndex=-1,lrnCol=-1,nameCol=-1,sexCol=-1,parentCol=-1,contactCol=-1,fatherCol=-1,motherCol=-1,guardianCol=-1,birthCol=-1,addressCols=[];
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
  if(li>=0 && ni>=0 && li!==ni){
   headerIndex=i;lrnCol=li;nameCol=ni;sexCol=si;
   parentCol=findOptionalColumn(rows,i,v=>/^(?:nameof(?:parent|guardian)|parentguardianname|parentname|guardianname|nameofparentguardian|parentguardian|guardianparentname)/.test(v));
   contactCol=findOptionalColumn(rows,i,v=>/^(?:contactnumber|contactno|contactnos|mobilenumber|mobileno|cellphonenumber|cellphoneno|parentcontact|guardiancontact|parentmobilenumber|guardianmobilenumber)/.test(v));
   fatherCol=findOptionalColumn(rows,i,v=>/^(?:fathers?name|nameof(?:the)?father|fatherfullname)/.test(v));
   motherCol=findOptionalColumn(rows,i,v=>/^(?:mothers?(?:maiden)?name|nameof(?:the)?mother|motherfullname)/.test(v));
   guardianCol=findOptionalColumn(rows,i,v=>/^(?:guardians?name|nameofguardian|nameofguardianifnotparent)/.test(v));
   birthCol=findOptionalColumn(rows,i,v=>/^(?:birthdate|dateofbirth|birthday|dob)/.test(v));
   addressCols=[];
   for(let offset=0;offset<Math.min(3,rows.length-i);offset++)(rows[i+offset]||[]).map(normalize).forEach((v,c)=>{
    if(/^(?:housestreet|street|barangay|citymunicipality|municipalitycity|province|homeaddress|completeaddress|residentialaddress|address)$/.test(v)&&!addressCols.includes(c))addressCols.push(c);
   });
   break;
  }
 }
 if(headerIndex<0) throw Error('The workbook does not show an identifiable SF1 LRN and NAME header. Export the official School Form 1 from LIS.');
 if(!grade) throw Error('Could not identify the SF1 grade level. Verify the School Form 1 header before importing.');
 const learners=[],errors=[];
 let currentSex='';
 for(let i=headerIndex+1;i<rows.length;i++){
  const row=rows[i].map(asText), rawLrn=digits(row[lrnCol]), rawName=asText(row[nameCol]).trim();
  const line=row.join(' ').trim();
  if(/^\s*(male|female)\s*$/i.test(rawName)){currentSex=rawName.toUpperCase();continue;}
  // Official LIS roster exports put 3, 25, 28 etc. in the LRN column for
  // '<=== TOTAL MALE', '<=== TOTAL FEMALE', and '<=== COMBINED' summary rows.
  // Exclude these only by the explicit summary label; a malformed learner LRN
  // must still block the entire import.
  const summaryLabel=rawName.replace(/^[\s<>=:\-]+/,'').trim();
  if(/^(?:total(?:\s+(?:male|female|learners))?|combined(?:\s+total)?|grand\s+total|subtotal|prepared\s+by|certified\s+correct|school\s+form|generated\s+thru\s+lis)\b/i.test(summaryLabel))continue;
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
  const nameSource=parentCol>=0?row[parentCol]:'';
  const parentName=blank(nameSource)?'':asText(nameSource).trim().replace(/\s+/g,' ');
  const contactSource=contactCol>=0?row[contactCol]:'';
  const parentMobile=normalizeGuardianContact(contactSource);
  if(parentName.length>200){errors.push({rowNumber:i+1,message:'Parent/guardian name exceeds 200 characters.'});continue;}
  if(parentMobile===null){errors.push({rowNumber:i+1,message:'Invalid or ambiguous parent/guardian contact number.'});continue;}
  const familyValue=index=>index<0||blank(row[index])?'':asText(row[index]).trim().replace(/\s+/g,' ');
  const fatherName=familyValue(fatherCol),motherMaidenName=familyValue(motherCol),sf1GuardianName=familyValue(guardianCol);
  if([fatherName,motherMaidenName,sf1GuardianName].some(x=>x.length>200)){
   errors.push({rowNumber:i+1,message:'An SF1 family name exceeds 200 characters.'});continue;
  }
  const rawBirth=familyValue(birthCol);
  let birthDate='';
  if(rawBirth){
   const parsed=rawBirth.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)||rawBirth.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
   if(parsed){
    const y=parsed[1].length===4?+parsed[1]:+parsed[3],m=parsed[1].length===4?+parsed[2]:+parsed[1],d=parsed[1].length===4?+parsed[3]:+parsed[2];
    const date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d&&y>=1900&&date<=new Date())birthDate=String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
   }
   if(!birthDate){errors.push({rowNumber:i+1,message:'Birth date cannot be validated; check the LIS SF1 date.'});continue;}
  }
  const sf1Address=addressCols.map(index=>familyValue(index)).filter(Boolean).join(', ');
  if(sf1Address.length>500){errors.push({rowNumber:i+1,message:'SF1 address exceeds 500 characters.'});continue;}
  // Do not infer that either parent is the legally designated guardian.
  // A guardian named "if not parent" is stored separately, not as primary parent_name.
  learners.push({rowNumber:i+1,lrn:rawLrn,fullName:extractName(rawName),sex,gradeLevel:grade,section:'Unassigned',studentId:'',parentName,parentMobile,fatherName,motherMaidenName,sf1GuardianName,birthDate,sf1Address});
 }
 if(!learners.length) throw Error('No valid SF1 learners were found. Check the LIS-exported workbook.');
 if(learners.length>2000) throw Error('Import a maximum of 2,000 learners at once.');
 return {learners,gradeLevel:grade,schoolYear,errors};
}
// DepEd LIS still exports genuine Excel 97-2003 BIFF8 workbooks (.xls).
// Keep the existing ExcelJS .xlsx path, but read BIFF8 with a maintained parser.
function parseLegacySf1Xls(data) {
 let workbook;
 try {
  workbook = XLSX.read(data, {type:'buffer',bookVBA:false,cellFormula:false,cellStyles:false,sheetRows:4501});
 } catch (_) { throw Error('Could not read the LIS .xls workbook. Download a fresh SF1 from LIS without changing its extension.'); }
 if (!workbook.SheetNames?.length || workbook.SheetNames.length>15)
  throw Error('The LIS workbook does not contain a supported number of worksheets.');
 const results=[];
 for (const sheetName of workbook.SheetNames) {
  const sheet=workbook.Sheets[sheetName];
  if (!sheet?.['!ref']) continue;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  // sheetRows limits parsing, so hitting row 4,501 is also an error.
  if (range.e.r >= 4500) throw Error('The SF1 worksheet is too large.');
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true});
  try {results.push(parseSf1Matrix(rows.map(row=>row.slice(0,55))));}
  catch(e){if(/no valid SF1|does not show an identifiable|Could not identify/.test(e.message))continue;throw e;}
 }
 if(results.length!==1)throw Error(results.length?'Multiple SF1 roster worksheets detected. Upload one class SF1 workbook at a time.':'Could not detect an SF1 roster in this .xls workbook.');
 return results[0];
}

async function parseSf1Base64(base64, fileType='xlsx') {
 if(typeof base64!=='string'||!base64.length)throw Error('Choose an SF1 Excel workbook.');
 const data=Buffer.from(base64,'base64');
 if(!data.length||data.length>MAX_BYTES)throw Error('The SF1 workbook must be 5 MB or smaller.');
 if(!['xls','xlsx'].includes(fileType)) throw Error('Unsupported SF1 Excel format. Choose .xls or .xlsx.');
 const isLegacy=data.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
 const isOpenXml=data.subarray(0,2).toString('ascii')==='PK';
 if(fileType==='xls') {
  if(!isLegacy)throw Error('This is not a genuine Excel .xls workbook. Export SF1 again from LIS.');
  return parseLegacySf1Xls(data);
 }
 if(!isOpenXml)throw Error('This is not a valid .xlsx workbook. If LIS exported .xls, select the original .xls file.');
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
module.exports={parseSf1Matrix,parseSf1Base64,extractName,normalizeGuardianContact};