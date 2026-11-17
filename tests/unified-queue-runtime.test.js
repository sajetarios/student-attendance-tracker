'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'public/offline-attendance.js'), 'utf8');

function fakeIndexedDB() {
  const stores = new Map();
  let version = 0;
  const withStore = (name, tx) => {
    const schema = stores.get(name);
    if (!schema) throw Error('No store: ' + name);
    const request = execute => {
      const req = {};
      tx.pending++;
      queueMicrotask(() => {
        try {
          req.result = execute();
          req.onsuccess?.();
        } catch (error) {
          req.error = error;
          tx.error = error;
          req.onerror?.();
          tx.onabort?.();
        } finally {
          tx.pending--;
          queueMicrotask(() => {
            if (tx.pending === 0 && !tx.error) tx.oncomplete?.();
          });
        }
      });
      return req;
    };
    return {
      indexNames: { contains: key => schema.indices.has(key) },
      createIndex: key => schema.indices.add(key),
      get(key) { return request(() => schema.data.get(key) || null); },
      getAll() { return request(() => [...schema.data.values()]); },
      put(value) {
        return request(() => {
          schema.data.set(value[schema.keyPath], value);
          return value[schema.keyPath];
        });
      },
      add(value) {
        return request(() => {
          if (schema.data.has(value[schema.keyPath])) throw Error('ConstraintError');
          schema.data.set(value[schema.keyPath], value);
          return value[schema.keyPath];
        });
      },
      delete(key) { return request(() => schema.data.delete(key)); },
      index(key) {
        if (!schema.indices.has(key)) throw Error('No index');
        return { getAll(value) {
          return request(() => [...schema.data.values()].filter(item => item[key] === value));
        } };
      }
    };
  };
  return {
    stores,
    open(_name, requestedVersion) {
      const req = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore(name, options) {
            stores.set(name, { keyPath: options.keyPath, data: new Map(), indices: new Set() });
            return withStore(name, { pending:0 });
          },
          transaction(name, mode) {
            const tx = { pending:0, error:null };
            tx.objectStore = () => withStore(name, tx);
            return tx;
          },
          close() {}
        };
        req.result = db;
        req.transaction = { objectStore(name) { return withStore(name, { pending:0 }); } };
        if (version < requestedVersion) {
          version = requestedVersion;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    }
  };
}

function harness() {
  const indexedDB = fakeIndexedDB();
  const session = new Map([
    ['schoolAttendance.user', JSON.stringify({schoolId:'school-A',userId:'teacher-1'})],
    ['schoolAttendance.accessToken', 'token-A']
  ]);
  const requests = [];
  let responder = async () => ({status:200,ok:true,json:async()=>({})});
  const navigator = {onLine:false};
  const window = { dispatchEvent() {}, addEventListener() {} };
  const document = {readyState:'loading', addEventListener(){}, getElementById(){return null}};
  vm.runInNewContext(source,{
    indexedDB, sessionStorage: {
      getItem:key=>session.get(key)||null,
      setItem:(key,value)=>session.set(key,value)
    },
    crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,JSON,
    URLSearchParams, navigator, window, document,
    fetch: async (url,options={}) => {
      requests.push({url,options});
      return responder(url,options);
    },
    CustomEvent:class CustomEvent{constructor(_type,init){this.detail=init.detail;}},
    setInterval() {}
  });
  return {
    queue:window.AttendigoOffline,indexedDB,session,navigator,requests,
    respond:fn=>{responder=fn;}
  };
}
const response = (code,body) => ({status:code,ok:code>=200&&code<300,json:async()=>body});
const scan = id => ({
  eventId:id, studentId:'learner-1', eventType:'TIME_IN',
  attendanceScope:'CLASS',periodId:'class-1',schoolDate:'2026-11-16',
  occurredAt:'2026-11-16T00:05:00Z'
});
const manual = () => ({
  periodId:'class-1',date:'2026-11-16',
  marks:[{studentId:'learner-1',status:'PRESENT',note:'',expectedRevision:0}]
});
const signoff = () => ({
  periodId:'class-1',date:'2026-11-16',action:'FINALIZE'
});

test('three types remain encrypted on device, then sync in order with confirmed readback',async()=>{
  const h=harness();
  await h.queue.enqueueOperation({type:'QR_SCAN',operationId:'scan-1',payload:scan('scan-1')});
  await h.queue.enqueueOperation({type:'MANUAL_MARKS',operationId:'mark-1',payload:manual()});
  await h.queue.enqueueOperation({type:'REGISTER_SIGNOFF',operationId:'sign-1',payload:signoff()});
  const offline=await h.queue.pending();
  assert.equal(offline.length,3);
  for(const row of offline) {
    assert.ok(row.encrypted?.ciphertext?.length);
    assert.equal(row.event,undefined);
    assert.equal(JSON.stringify(row).includes('learner-1'),false);
  }
  h.navigator.onLine=true;
  h.respond(async url => {
    if(url==='/api/sync/events')return response(200,{results:[{status:'ACCEPTED',eventId:'scan-1'}]});
    if(url==='/api/manual-attendance/sync')return response(200,{saved:1});
    if(url.startsWith('/api/manual-attendance?'))
      return response(200,{marks:[{studentId:'learner-1',status:'PRESENT',note:'',revision:'1'}]});
    if(url==='/api/manual-attendance/finalization')return response(200,{finalized:true});
    return response(404,{error:'Unexpected URL '+url});
  });
  const synced=await h.queue.sync();
  assert.equal((await h.queue.pending()).length,0);
  assert.equal(synced.confirmations['scan-1'].status,'ACCEPTED');
  assert.equal(synced.confirmations['mark-1'].status,'ACCEPTED');
  assert.equal(synced.confirmations['sign-1'].status,'ACCEPTED');
  assert.deepEqual(h.requests.map(r=>r.url),[
    '/api/sync/events','/api/manual-attendance/sync',
    '/api/manual-attendance?periodId=class-1&date=2026-11-16',
    '/api/manual-attendance/finalization'
  ]);
});
test('409 conflicts stay encrypted and block later sign-offs instead of losing or replaying them',async()=>{
  const h=harness();
  await h.queue.enqueueOperation({type:'MANUAL_MARKS',operationId:'mark-1',payload:manual()});
  await h.queue.enqueueOperation({type:'REGISTER_SIGNOFF',operationId:'sign-1',payload:signoff()});
  h.navigator.onLine=true;
  h.respond(async()=>response(409,{error:'Stale attendance revision'}));
  await h.queue.sync();
  const rows=await h.queue.pending();
  assert.equal(rows.find(x=>x.id==='mark-1').status,'REVIEW');
  assert.equal(rows.find(x=>x.id==='sign-1').status,'PENDING');
  await h.queue.sync();
  assert.equal(h.requests.length,1,'No later operation may bypass the review barrier');
});
test('queue is scoped by current user and retains legacy scanner records during storage upgrade',async()=>{
  const h=harness();
  await h.queue.enqueueOperation({type:'QR_SCAN',operationId:'scan-A',payload:scan('scan-A')});
  h.session.set('schoolAttendance.user',JSON.stringify({schoolId:'school-B',userId:'teacher-2'}));
  assert.equal((await h.queue.pending()).length,0);
  await h.queue.enqueueOperation({type:'QR_SCAN',operationId:'scan-B',payload:scan('scan-B')});
  assert.equal((await h.queue.pending()).length,1);
  h.session.set('schoolAttendance.user',JSON.stringify({schoolId:'school-A',userId:'teacher-1'}));
  assert.equal((await h.queue.pending()).length,1);
  h.indexedDB.stores.get('events').data.set('old-scan',{
    id:'old-scan',owner:'school-A:teacher-1',event:scan('old-scan'),status:'PENDING',createdAt:1
  });
  const legacy=(await h.queue.pending()).find(r=>r.id==='old-scan');
  assert.ok(legacy && legacy.event.eventId==='old-scan');
});
