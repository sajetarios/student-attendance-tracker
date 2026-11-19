'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ExcelJS=require('exceljs');
const {registerSf1ImportRoutes}=require('../sf1-import-routes');

async function makeOfficialSf1(){
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('School Form 1');
  sheet.addRow(['School Form 1 (SF1) School Register']);
  sheet.addRow(['School Year: 2026-2027','Grade Level: 8']);
  sheet.addRow(['LRN','NAME (Last Name, First Name, Middle Name)','Sex (M/F)']);
  sheet.addRow(['123456789012','REYES, ANA, MARIA','F']);
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}
function mockApi(){
  const handlers=new Map();
  const app={post:(route,...fn)=>handlers.set(route,fn[fn.length-1])};
  const calls=[];
  const pool={query:async(sql)=>{
    calls.push(sql);
    if(sql.includes('FROM school_years'))return {rowCount:0,rows:[]};
    throw Error('Unexpected query: '+sql);
  }};
  registerSf1ImportRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
  return {handlers,calls};
}
test('A readable LIS SF1 with no configured year returns structured setup requirement without writing',async()=>{
  const {handlers,calls}=mockApi(),fileBase64=await makeOfficialSf1();
  const req={auth:{role:'SCHOOL_ADMIN',schoolId:'school-test',userId:'admin-test'},body:{fileBase64,fileType:'xlsx'}};
  let status=0,body;
  const res={status(n){status=n;return this;},json(value){body=value;return this;}};
  await handlers.get('/api/students/sf1/preview')(req,res);
  assert.equal(status,409);
  assert.equal(body.code,'SF1_SCHOOL_YEAR_REQUIRED');
  assert.equal(body.schoolYear,'2026-2027');
  assert.equal(calls.length,1);
  assert.match(calls[0],/^SELECT school_year_id/);
});
test('Year setup guidance is admin-only and section update checkbox is explicitly hidden',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
  const academic=fs.readFileSync(path.join(root,'academic-routes.js'),'utf8');
  assert.match(html,/id="studentImportSchoolYearSetup"[^>]*hidden/);
  assert.match(html,/#studentImportUpdateExistingWrap\[hidden\]/);
  assert.match(html,/id="studentImportYearStart"/);
  assert.match(html,/id="studentImportYearEnd"/);
  assert.match(js,/error\.code==='SF1_SCHOOL_YEAR_REQUIRED'/);
  assert.match(js,/if \(user\.role !== 'SCHOOL_ADMIN'\)/);
  assert.match(js,/School Years & Programs/);
  assert.match(js,/await api\('\/api\/school-years'/);
  assert.match(js,/await api\('\/api\/school-years\/'.*\+'\/status'/);
  assert.match(js,/await previewStudentImport\(\)/);
  assert.match(academic,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
  assert.match(academic,/app\.patch\('\/api\/school-years\/:id\/status'/);
});
