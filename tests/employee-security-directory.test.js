'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseSecurityDirectoryQuery,registerEmployeeSecurityDirectoryRoutes}=require('../employee-security-directory-routes');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('security directory paging query only allows bounded, validated, school-safe filters',()=>{
 assert.deepEqual(parseSecurityDirectoryQuery({}),{
  search:'',role:'ALL',department:'ALL',status:'ALL',page:1,limit:25
 });
 assert.equal(parseSecurityDirectoryQuery({page:'40',limit:'25'}).page,40);
 assert.equal(parseSecurityDirectoryQuery({search:'a'.repeat(121)}),null);
 assert.equal(parseSecurityDirectoryQuery({role:'STUDENT'}),null);
 assert.equal(parseSecurityDirectoryQuery({status:'UNKNOWN'}),null);
 assert.equal(parseSecurityDirectoryQuery({department:'invalid'}),null);
 assert.equal(parseSecurityDirectoryQuery({page:'-1'}),null);
 assert.equal(parseSecurityDirectoryQuery({page:'0'}),null);
 assert.equal(parseSecurityDirectoryQuery({page:'10001'}),null);
 assert.equal(parseSecurityDirectoryQuery({limit:'1000'}),null);
 assert.equal(parseSecurityDirectoryQuery({limit:'25;DROP TABLE'}),null);
});
test('directory registers admin-only GET, pages results on server and parameterizes school/search',async()=>{
 const routes=[];
 const auth=(_req,_res,next)=>next();
 const admin=(_req,_res,next)=>next();
 const app={get:(...args)=>routes.push(args)};
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT COUNT'))return {rows:[{total:117}]};
  if(sql.startsWith('SELECT DISTINCT'))return {rows:[{
   departmentId:'11111111-1111-4111-8111-111111111111',departmentName:'Science'
  }]};
  if(sql.includes('LIMIT $6 OFFSET $7'))return {rows:[{
   userId:'22222222-2222-4222-8222-222222222222',username:'teacher.test',
   displayName:'Test Teacher',role:'TEACHER',active:true,activeSessions:0
  }]};
  throw Error('Unexpected query');
 }};
 registerEmployeeSecurityDirectoryRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolAdmin:admin});
 assert.equal(routes.length,1);
 const [endpoint,a,b,handler]=routes[0];
 assert.equal(endpoint,'/api/admin/security/accounts/paged');
 assert.equal(a,auth);assert.equal(b,admin);
 let status=200,header='',response;
 const req={auth:{schoolId:'school-abc'},query:{
  search:"O'Reilly",role:'TEACHER',status:'LOCKED',
  department:'11111111-1111-4111-8111-111111111111',page:'4',limit:'25'
 }};
 const res={set:(k,v)=>{header=k+'='+v;return res;},status:n=>{status=n;return res;},json:x=>{response=x;return res;}};
 await handler(req,res);
 assert.equal(status,200);
 assert.equal(header,'Cache-Control=no-store, private');
 assert.equal(response.total,117);
 assert.equal(response.pages,5);
 assert.equal(response.page,4);
 assert.equal(response.accounts.length,1);
 assert.equal(calls.length,3);
 for(const call of calls)assert.equal(call.args[0],'school-abc');
 const selected=calls.find(x=>x.sql.includes('LIMIT $6 OFFSET $7'));
 assert.deepEqual(selected.args,['school-abc',"O'Reilly",'TEACHER',
  '11111111-1111-4111-8111-111111111111','LOCKED',25,75]);
 assert.ok(!selected.sql.includes("O'Reilly"));
 assert.match(selected.sql,/school_id=\$1/);
 assert.match(selected.sql,/role IN \('TEACHER','DEPARTMENT_HEAD','GATE_KEEPER'\)/);
 assert.doesNotMatch(selected.sql,/UPDATE\s+school_users|DELETE\s+FROM/i);
});
test('directory returns 400 on malicious or invalid page params before querying',async()=>{
 let called=false,handler;
 registerEmployeeSecurityDirectoryRoutes({get:(_url,_a,_b,fn)=>{handler=fn}},
  {query:async()=>{called=true;throw Error('Should not query');}},
  {authenticateSchoolClient:()=>{},requireSchoolAdmin:()=>{}});
 let status=200,result;
 const res={set:()=>res,status:n=>{status=n;return res;},json:x=>{result=x;return res;}};
 await handler({auth:{schoolId:'any'},query:{role:'SUPER_ADMIN'}},res);
 assert.equal(status,400);
 assert.match(result.error,/Invalid/);
 assert.equal(called,false);
});
test('staff security cards begin collapsed with explicit ARIA reveal and filtered paging',()=>{
 const html=read('public/portal.html');
 const js=read('public/portal.js');
 const css=read('public/user-management-readability.css');
 const sw=read('public/sw.js');
 const server=read('server.js');
 for(const id of ['securityAccountsSearch','securityAccountsDepartment','securityAccountsRole',
  'securityAccountsStatus','securityAccountsPageSize','securityAccountsPrevious',
  'securityAccountsNext','securityAccountsCount','securityAccountsPageInfo']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(js,/security-account-collapsed/);
 assert.match(js,/data-security-toggle/);
 assert.match(js,/aria-expanded/);
 assert.match(js,/Show details/);
 assert.match(js,/Hide details/);
 assert.match(js,/expandedSecurityAccountId/);
 assert.match(js,/securityAccountsRequest/);
 assert.match(js,/securityAccountsPage/);
 assert.match(js,/accounts\/paged\?/);
 assert.match(css,/\.security-account-collapsed td:not\(:first-child\)/);
 assert.match(css,/max-width:1450px/);
 assert.match(css,/max-width:440px/);
 assert.match(css,/security-directory-filters/);
 assert.match(server,/registerEmployeeSecurityDirectoryRoutes/);
 assert.match(sw,/user-management-readability\.css\?v=6/);
 assert.match(html,/portal\.js\?v=198/);
 for(const action of ['data-reset-staff-password','data-revoke-staff-sessions','data-unlock-staff-account']){
  assert.ok(js.includes(action),action);
 }
});
