const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/offline-sheet.js'),'utf8');
function launch({online=true,periods=[],reject=false,students=[],saved=[],outbox=new Map(),remote=new Map()}={}){
 const u={role:'TEACHER',schoolId:'school-a',userId:'teacher-a'};
 const nodes=new Map(),listeners={},requests=[],enqueues=[];
 const make=()=>({children:[],dataset:{},open:false,disabled:false,hidden:true,value:'',append(...items){this.children.push(...items)},setAttribute(){},get lastElementChild(){return this.children.at(-1)},replaceChildren(){this.children=[]},addEventListener(name,fn){this[name]=fn}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)},createElement:make};
 const guard={authorize:async()=>({role:u.role,schoolId:u.schoolId,accountId:u.userId}),requireRole:()=>({schoolId:u.schoolId,accountId:u.userId}),matches:(r,s,i)=>r===u.role&&s===u.schoolId&&i===u.userId,record(){},clear(){},watch(){},current:()=>({schoolId:u.schoolId,accountId:u.userId})};
 const records=new Map(saved.map(row=>[row.id,row]));
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={objectStore(){const request=fn=>{const q={};queueMicrotask(()=>{try{q.result=fn();q.onsuccess?.();tx.oncomplete?.();}catch(e){tx.error=e;tx.onabort?.();}});return q};return {getAll:()=>request(()=>[...records.values()]),get:id=>request(()=>records.get(id)),put:row=>request(()=>{records.set(row.id,row);return row.id;}),add:row=>request(()=>{if(records.has(row.id))throw Object.assign(Error('duplicate'),{name:'ConstraintError'});records.set(row.id,row);return row.id;})}}};return tx}};req.onsuccess()});return req}};

 const queue={pending:async()=>[...outbox.values()],enqueueOperation:async({operationId,type,payload})=>{enqueues.push(operationId);const old=outbox.get(operationId);if(old&&JSON.stringify(old.payload)!==JSON.stringify(payload))throw Error('Changed payload');outbox.set(operationId,{id:operationId,type,payload,status:'PENDING'});return {operationId};},sync:async()=>{if(!context.navigator.onLine)return;for(const [id,row] of outbox){for(const m of row.payload.marks)remote.set(row.payload.date+':'+m.studentId,{...m,revision:1});outbox.delete(id);}}};
 const context={window:{AttendigoOffline:queue,AttendigoOfflineAccount:guard,addEventListener(n,f){listeners[n]=f}},document,navigator:{onLine:online},sessionStorage:{getItem(){return null}},indexedDB,TextEncoder,TextDecoder,Intl,URLSearchParams,Uint8Array,btoa,atob,crypto:require('node:crypto').webcrypto,fetch:async(url,opts)=>{requests.push({url,opts});if(reject&&url.startsWith('/api/periods'))return {ok:false,status:503,json:async()=>({error:'Unavailable'})};return {ok:true,json:async()=>url==='/api/auth/me'?{user:u,expiresAt:new Date(Date.now()+3600000).toISOString()}:url.startsWith('/api/periods')?{periods}:url.startsWith('/api/manual-attendance?')?{marks:[...remote.entries()].filter(([key])=>key.startsWith(new URLSearchParams(url.split('?')[1]).get('date')+':')).map(([,m])=>m)}:{students}}}};
 vm.runInNewContext(source,context);return {document,requests,listeners,context,records,outbox,remote,enqueues};
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
test('staff session verification includes authoritative expiry',()=>{
 const auth=fs.readFileSync(path.join(__dirname,'../auth-routes.js'),'utf8').split("app.get('/api/auth/me'")[1].split("app.post('/api/auth/logout'")[0];
 assert.match(auth,/us\.expires_at,/);assert.match(auth,/expiresAt: new Date\(row\.expires_at\)\.toISOString\(\)/);
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

const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}assert.ok(predicate(),'Expected asynchronous operation to complete');};
test('offline save queues marks before close, restores without replay, then confirms server readback',async()=>{
 const period={periodId:'class1',assignedTeacherUserId:'teacher-a',gradeLevel:8,section:'A',subjectName:'English'};
 const students=[{studentId:'learner1',fullName:'Example Learner',gradeLevel:8,section:'A'}];
 const password='a secure offline password';
 const first=launch({periods:[period],students});const a=id=>first.document.getElementById(id);
 await settle();a('preparePass').value=password;a('prepareAll').click();await waitFor(()=>first.records.size===1&&!a('prepareAll').disabled);
 first.context.navigator.onLine=false;first.listeners.offline();
 a('unlockClass').value='school-a:teacher-a:class1';a('unlockPass').value=password;a('open').click();
 await waitFor(()=>a('rows').children.length===1&&!a('open').disabled);
 const date=a('date').value;const selector=a('rows').children[0].children[1];selector.value='PRESENT';selector.change();
 a('save').click();await waitFor(()=>first.outbox.size===1&&!a('save').disabled);
 assert.equal(first.enqueues.length,1);assert.equal([...first.outbox.values()][0].payload.marks[0].status,'PRESENT');
 assert.equal(a('rows').children[0].children[1].disabled,true);
 a('save').click();await waitFor(()=>!a('save').disabled);assert.equal(first.enqueues.length,1);
 a('lock').click();await waitFor(()=>a('sheet').hidden);
 const second=launch({online:false,saved:[...first.records.values()],outbox:first.outbox,remote:first.remote});
 const b=id=>second.document.getElementById(id);await settle();
 b('unlockClass').value='school-a:teacher-a:class1';b('unlockPass').value=password;b('open').click();
 await waitFor(()=>b('rows').children.length===1&&!b('open').disabled);
 assert.equal(second.enqueues.length,0);assert.equal(b('rows').children[0].children[1].value,'PRESENT');
 second.context.navigator.onLine=true;second.listeners.online();
 await waitFor(()=>second.outbox.size===0&&!b('save').disabled&&/confirmed by the school server/.test(b('message').textContent));
 assert.equal(second.remote.get(date+':learner1').status,'PRESENT');
 assert.equal(b('rows').children[0].children[1].disabled,false);assert.equal(second.enqueues.length,0);
});
