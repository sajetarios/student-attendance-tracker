'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseSettings,parseLogo,printableBranding,registerDocumentBranding}=require('../school-document-branding');
const {createAuthMiddleware}=require('../auth-middleware');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const detect=b=>Buffer.isBuffer(b)&&b[0]===137?{mime:'image/png'}:Buffer.isBuffer(b)&&b[0]===255?{mime:'image/jpeg'}:null;
const logo=Buffer.from([137,80,78,71,13,10,26,10]);
const settings={region:'Region XI',division:'Example Division',address:'Example Address',officialSchoolId:'123456',layout:'DUAL'};
test('document identity validation accepts blank optional fields but rejects invalid layout, types and control characters',()=>{
 assert.deepEqual(parseSettings({layout:'TEXT'}),{region:'',division:'',address:'',officialSchoolId:'',layout:'TEXT'});
 assert.deepEqual(parseSettings(settings),settings);
 for(const b of [{layout:'bad'},{layout:'TEXT',region:2},{layout:'TEXT',address:'a'.repeat(241)},{layout:'TEXT',division:'a\nb'}])assert.throws(()=>parseSettings(b));
});
test('logo upload validates bytes and limits; absent and explicit removal differ',()=>{
 assert.equal(parseLogo(undefined,detect),undefined);assert.equal(parseLogo(null,detect),null);
 assert.deepEqual(parseLogo(logo.toString('base64'),detect),logo);
 assert.deepEqual(parseLogo(Buffer.from([255,216,255]).toString('base64'),detect),Buffer.from([255,216,255]));
 for(const value of ['bad!','',Buffer.from('html').toString('base64'),'A'.repeat(2800000)])assert.throws(()=>parseLogo(value,detect));
});
test('legacy schools and invalid/missing logos fall back without requiring metadata',()=>{
 const b=printableBranding({school_name:'Example',logo_data:Buffer.from('bad')},detect);
 assert.equal(b.layout,'AUTO');assert.equal(b.schoolName,'Example');assert.equal(b.schoolLogo,null);assert.equal(b.agencyLogo,null);
 assert.match(printableBranding({logo_data:logo},detect).schoolLogo,/^data:image\/png;base64,/);
});
function setup(){
 const handlers={},queries=[],row={school_name:'School A',document_branding:settings,logo_data:logo};
 const pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:[row],rowCount:1};}};
 const app={get:(p,...h)=>handlers['get '+p]=h,put:(p,...h)=>handlers['put '+p]=h};
 registerDocumentBranding(app,pool,{...createAuthMiddleware(pool),canCustomizeBranding:()=>{},detectLogo:detect});
 return {handlers,queries};
}
function response(){return {statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
test('read and write are scoped to the signed-in school; only admin role can save',async()=>{
 const {handlers,queries}=setup(),p='/api/school/document-branding',get=handlers['get '+p],put=handlers['put '+p];
 for(const role of ['TEACHER','PRINCIPAL','DEPARTMENT_HEAD','SCHOOL_ADMIN','STUDENT','PARENT','GATE_KEEPER']){
  let readOk=false,writeOk=false;
  const req={auth:{type:'SCHOOL_USER',role}};
  get[1](req,response(),()=>readOk=true);put[1](req,response(),()=>writeOk=true);
  assert.equal(readOk,['TEACHER','PRINCIPAL','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(role));
  assert.equal(writeOk,role==='SCHOOL_ADMIN');
 }
 const req={auth:{schoolId:'school-a',userId:'actor'},query:{schoolId:'school-b'},body:{...settings,schoolId:'school-b'}};
 await get.at(-1)(req,response());assert.deepEqual(queries[0].args,['school-a']);
 await put.at(-1)(req,response());assert.equal(queries[1].args[0],'school-a');assert.equal(queries[1].args[2],false);
 assert.match(queries[1].sql,/audit_logs/);assert.doesNotMatch(queries[1].sql,/staff_leave|attendance_events/i);
 req.body.agencyLogo=null;await put.at(-1)(req,response());assert.equal(queries[2].args[2],true);assert.equal(queries[2].args[3],null);
});
test('Form 6 blank template and request failures never require branding or expose unauthorized application',async()=>{
 for(const search of ['?template=1','?requestId=11111111-1111-4111-8111-111111111111']){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{disabled:true,append(){},replaceChildren(){},addEventListener(){}});return nodes.get(id);};
  const calls=[];
  await vm.runInNewContext(read('public/leave-form6.js'),{URLSearchParams,location:{search},window:{},sessionStorage:{getItem:()=>null},document:{getElementById:get,createElement:()=>({})},fetch:async url=>{calls.push(url);return {ok:false,json:async()=>({error:'Unauthorized'})};}});
  if(search.includes('template')){assert.equal(get('print').disabled,false);assert.deepEqual(calls,['/api/school/document-branding']);}
  else{assert.equal(get('print').disabled,true);assert.equal(calls.length,1);assert.match(calls[0],/requests\/.*\/form6/);}
 }
});
test('Form 6 layout options never render untrusted external images',async()=>{
 for(const layout of ['AUTO','DUAL','AGENCY','SCHOOL','TEXT']){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{disabled:true,append(){},replaceChildren(){},addEventListener(){},decode:async()=>{}});return nodes.get(id);};
  const branding={...settings,layout,schoolName:'Example',schoolLogo:'data:image/png;base64,AAAA',agencyLogo:'https://untrusted.invalid/image'};
  await vm.runInNewContext(read('public/leave-form6.js'),{URLSearchParams,location:{search:'?template=1'},window:{},sessionStorage:{getItem:()=>null},document:{getElementById:get,createElement:()=>({})},fetch:async()=>({ok:true,json:async()=>({branding})})});
  assert.equal(get('print').disabled,false);assert.equal(get('school').textContent,'Example');
  assert.equal(get('formLogoLeft').hidden,['TEXT','AGENCY'].includes(layout));
  assert.equal(get('formLogoRight').hidden,true);
 }
});
test('document UI reuses school identity and mobile/print separation',()=>{
 const ui=read('public/portal.html'),css=read('public/document-branding.css'),print=read('public/leave-form6.html');
 assert.match(ui,/id="schoolBrandingView"[\s\S]*id="documentBrandingForm"/);assert.match(css,/max-width:640px/);
 assert.match(print,/@media print/);assert.match(print,/ANNEX A/);assert.match(print,/Stamp of Date of Receipt/);
 assert.match(read('public/leave-form6.js'),/credentials:'same-origin'/);assert.match(read('public/sw.js'),/"\/leave-form6.html"\].includes/);
});
