const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/offline-sheet.js'),'utf8');
function launch({online=true,periods=[],reject=false,students=[],saved=[]}={}){
 const u={role:'TEACHER',schoolId:'school-a',userId:'teacher-a'};
 const nodes=new Map(),listeners={},requests=[];
 const make=()=>({children:[],dataset:{},open:false,disabled:false,hidden:true,value:'',append(x){this.children.push(x)},replaceChildren(){this.children=[]},addEventListener(name,fn){this[name]=fn}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)},createElement:make};
 const guard={authorize:async()=>({role:u.role,schoolId:u.schoolId,accountId:u.userId}),requireRole:()=>({schoolId:u.schoolId,accountId:u.userId}),matches:(r,s,i)=>r===u.role&&s===u.schoolId&&i===u.userId,record(){},clear(){},watch(){},current:()=>({schoolId:u.schoolId,accountId:u.userId})};
 const records=new Map(saved.map(row=>[row.id,row]));
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={objectStore(){const request=fn=>{const q={};queueMicrotask(()=>{try{q.result=fn();q.onsuccess?.();tx.oncomplete?.();}catch(e){tx.error=e;tx.onabort?.();}});return q};return {getAll:()=>request(()=>[...records.values()]),get:id=>request(()=>records.get(id)),add:row=>request(()=>{if(records.has(row.id))throw Object.assign(Error('duplicate'),{name:'ConstraintError'});records.set(row.id,row);return row.id;})}}};return tx}};req.onsuccess()});return req}};

 const context={window:{AttendigoOfflineAccount:guard,addEventListener(n,f){listeners[n]=f}},document,navigator:{onLine:online},sessionStorage:{getItem(){return null}},indexedDB,TextEncoder,TextDecoder,Intl,Uint8Array,btoa,atob,crypto:require('node:crypto').webcrypto,fetch:async(url,opts)=>{requests.push({url,opts});if(reject&&url.startsWith('/api/periods'))return {ok:false,status:503,json:async()=>({error:'Unavailable'})};return {ok:true,json:async()=>url==='/api/auth/me'?{user:u,expiresAt:new Date(Date.now()+3600000).toISOString()}:url.startsWith('/api/periods')?{periods}:{students}}}};
 vm.runInNewContext(source,context);return {document,requests,listeners,context,records};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('cookie-only restored teacher session loads only assigned classes',async()=>{
 const x=launch({periods:[{periodId:'mine',assignedTeacherUserId:'teacher-a',gradeLevel:8,section:'A',subjectName:'English'},{periodId:'other',assignedTeacherUserId:'teacher-b'}]});await settle();
 const get=id=>x.document.getElementById(id);
 assert.equal(get('prepare').disabled,false);assert.equal(get('unlockClass').disabled,true);
 assert.deepEqual(get('prepareClass').children.map(c=>c.value),['mine']);
 assert.match(x.requests.find(r=>r.url.startsWith('/api/periods')).url,/weekDate=\d{4}-\d{2}-\d{2}$/);
 for(const req of x.requests){assert.equal(req.opts.credentials,'same-origin');assert.equal(req.opts.headers?.Authorization,undefined);}
});
test('offline setup makes no network request and reconnect reloads classes',async()=>{
 const x=launch({online:false,periods:[{periodId:'mine',assignedTeacherUserId:'teacher-a'}]});await settle();
 assert.equal(x.requests.length,0);assert.equal(x.document.getElementById('prepare').disabled,true);
 x.context.navigator.onLine=true;x.listeners.online();await settle();assert.equal(x.document.getElementById('prepare').disabled,false);
});
test('failed class retrieval is explicit and retry remains available',async()=>{
 const x=launch({reject:true});await settle();assert.equal(x.document.getElementById('prepare').disabled,true);assert.equal(x.document.getElementById('reloadClasses').disabled,false);assert.match(x.document.getElementById('message').textContent,/Unavailable/);
});
test('staff session verification includes authoritative expiry',async()=>{
 const {registerAuthRoutes}=require('../auth-routes');
 const expiry=new Date(Date.now()+3600000),routes=new Map(),queries=[];
 const app={get(path,...handlers){routes.set('GET '+path,handlers.at(-1));},post(path,...handlers){routes.set('POST '+path,handlers.at(-1));}};
 const pool={async query(sql,params){
  queries.push({sql,params});
  if(sql.includes('FROM user_sessions us')){
   assert.match(sql,/us\.expires_at,/);
   assert.match(sql,/us\.revoked_at IS NULL AND us\.expires_at>NOW\(\)/);
   return {rowCount:1,rows:[{session_id:'session-a',principal_type:'SCHOOL',school_id:'school-a',school_user_id:'teacher-a',school_role:'TEACHER',expires_at:expiry}]};
  }
  assert.match(sql,/UPDATE user_sessions SET last_seen_at/);
  return {rowCount:1,rows:[]};
 }};
 registerAuthRoutes(app,pool);
 let status=200,body;
 const res={status(n){status=n;return this;},json(value){body=value;return this;}};
 await routes.get('GET /api/auth/me')({method:'GET',headers:{authorization:'Bearer test-session'}},res);
 assert.equal(status,200);assert.equal(body.expiresAt,expiry.toISOString());
 assert.equal(body.user.role,'TEACHER');assert.equal(body.user.userId,'teacher-a');
 assert.equal(body.user.schoolId,'school-a');assert.equal(queries.length,2);
});

test('bulk preparation saves all assigned classes without replacing existing encrypted data',async()=>{
 const saved={id:'school-a:teacher-a:old',label:'Existing',ciphertext:'preserve'};
 const periods=['old','new','empty'].map(periodId=>({periodId,assignedTeacherUserId:'teacher-a',gradeLevel:8,section:periodId==='empty'?'B':'A'}));
 periods.push({periodId:'other',assignedTeacherUserId:'teacher-b',gradeLevel:8,section:'A'});
 const x=launch({periods,students:[{studentId:'learner',fullName:'Test Learner',gradeLevel:8,section:'A'}],saved:[saved]});
 await settle();const get=id=>x.document.getElementById(id);
 assert.equal(get('prepareAll').disabled,false);get('preparePass').value='a secure device phrase';get('prepareAll').click();
 for(let i=0;i<100&&get('prepareAll').disabled;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(x.records.size,2);assert.equal(x.records.get(saved.id),saved);
 assert.ok(x.records.get('school-a:teacher-a:new').ciphertext);
 assert.equal(x.records.has('school-a:teacher-a:other'),false);
 assert.equal(x.records.has('school-a:teacher-a:empty'),false);
 assert.match(get('message').textContent,/1 newly prepared/);
 assert.equal(get('unlockClass').children.length,2);
 x.context.navigator.onLine=false;x.listeners.offline();assert.equal(get('prepareAll').disabled,true);
});

test('offline mode hides download setup and shows only saved class controls',async()=>{
 const x=launch({online:false,saved:[{id:'school-a:teacher-a:one',label:'English 8'}]});await settle();
 const get=id=>x.document.getElementById(id);
 assert.equal(get('setup').hidden,true);assert.equal(get('unlockFields').hidden,false);
 assert.equal(get('savedClassCount').textContent,'1 class ready offline');
 assert.match(get('connectionHint').textContent,/^Offline/);
 assert.equal(get('open').disabled,false);
});
test('first-time online setup opens downloads without empty password fields',async()=>{
 const x=launch({periods:[{periodId:'mine',assignedTeacherUserId:'teacher-a'}]});await settle();
 const get=id=>x.document.getElementById(id);
 assert.equal(get('setup').hidden,false);assert.equal(get('downloadSettings').open,true);assert.equal(get('unlockFields').hidden,true);
 assert.equal(get('prepareAll').disabled,false);
});
