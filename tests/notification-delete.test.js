'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
const {registerNotificationRoutes}=require('../notification-routes');

const school1='11111111-1111-4111-8111-111111111111';
const school2='22222222-2222-4222-8222-222222222222';
const schoolUser='33333333-3333-4333-8333-333333333333';
const otherUser='44444444-4444-4444-8444-444444444444';
const student='55555555-5555-4555-8555-555555555555';
const platform='66666666-6666-4666-8666-666666666666';
const notices={
 schoolRead:'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
 schoolUnread:'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 otherSchool:'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
 otherUser:'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
 student:'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
 platformRead:'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1',
 platformUnread:'ccccccc2-cccc-4ccc-8ccc-ccccccccccc2'
};

const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Notification delete actions appear in all three portals and retain approval workflows',()=>{
 const js=read('public/universal-notifications.js');
 const css=read('public/universal-notifications.css');
 const routes=read('notification-routes.js');
 for(const portal of ['public/portal.html','public/student-portal.html','public/parent-portal.html']) {
  assert.match(read(portal),/\/universal-notifications\.js\?v=4/);
  assert.match(read(portal),/\/universal-notifications\.css\?v=3/);
 }
 assert.match(read('public/sw.js'),/\/universal-notifications\.js\?v=4/);
 assert.match(read('public/sw.js'),/\/universal-notifications\.css\?v=3/);
 assert.match(js,/universal-delete-read/);
 assert.match(js,/universal-delete-read-center/);
 assert.match(js,/aria-label', 'Delete notification: '/);
 assert.match(js,/method: 'DELETE'/);
 assert.match(js,/await api\('\/delete-read', \{ method: 'POST' \}\)/);
 assert.match(js,/window\.confirm/);
 assert.match(css,/\.universal-notice-row/);
 assert.match(routes,/app\.delete\(base \+ '\/:id', authentication, own/);
 assert.match(routes,/app\.post\(base \+ '\/delete-read', authentication, own/);
 assert.match(routes,/school_id IS NOT DISTINCT FROM \$3/);
 assert.match(routes,/AND read_at IS NOT NULL/);
 assert.doesNotMatch(routes,/\b(?:DELETE|TRUNCATE)\s+(?:FROM\s+)?(?:audit_logs|students|school_users|staff_attendance_events|schools|student_enrollments)\b/i);
});
function safeLocalDb(){
 try{
  const u=new URL(process.env.DATABASE_URL||'');
  return ['localhost','127.0.0.1','::1'].includes(u.hostname) &&
    /(?:^|_)test(?:_|$)/i.test(decodeURIComponent(u.pathname).slice(1));
 }catch{return false;}
}
function makeHarness(db) {
 const endpoints=new Map();
 const app={
  get:(p,...handlers)=>endpoints.set('GET '+p,handlers),
  patch:(p,...handlers)=>endpoints.set('PATCH '+p,handlers),
  post:(p,...handlers)=>endpoints.set('POST '+p,handlers),
  delete:(p,...handlers)=>endpoints.set('DELETE '+p,handlers)
 };
 const auth=(_req,_res,next)=>next();
 registerNotificationRoutes(app,{query:(sql,args)=>db.query(sql,args)},{authenticateSchoolClient:auth,authenticatePlatform:auth});
 return async(method,endpoint,account,params={})=>{
  const handlers=endpoints.get(method+' '+endpoint);
  assert.ok(handlers,'Expected '+method+' '+endpoint);
  const req={path:endpoint,auth:account,params,query:{}};
  const res={
   statusCode:200,headers:{},
   status(n){this.statusCode=n;return this;},
   setHeader(k,v){this.headers[k]=v;return this;},
   json(data){this.body=data;return this;}
  };
  for(const handler of handlers) {
   let passed=false;
   await handler(req,res,()=>{passed=true;});
   if(!passed) break;
  }
  return res;
 };
}
test('Synthetic notification deletion is tenant-scoped, read cleanup preserves unread, platform and student stay isolated', {
 skip:!safeLocalDb() && 'Only runs against local *_test PostgreSQL; production database prohibited'
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  await db.query("CREATE TEMP TABLE user_notifications(notification_id uuid PRIMARY KEY,school_id uuid,recipient_kind text NOT NULL,recipient_id uuid NOT NULL,event_key text,category text,title text,body text,request_type text,request_id uuid,status text,action_url text,read_at timestamptz,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW())");
  const entries=[
   [notices.schoolRead,school1,'SCHOOL_USER',schoolUser,'Read item',true],
   [notices.schoolUnread,school1,'SCHOOL_USER',schoolUser,'Unread item',false],
   [notices.otherSchool,school2,'SCHOOL_USER',schoolUser,'Same user other school',true],
   [notices.otherUser,school1,'SCHOOL_USER',otherUser,'Someone else',true],
   [notices.student,school1,'STUDENT',student,'Student unread',false],
   [notices.platformRead,null,'PLATFORM',platform,'Platform read',true],
   [notices.platformUnread,null,'PLATFORM',platform,'Platform unread',false]
  ];
  for(const [id,s,k,u,title,isRead] of entries)
   await db.query("INSERT INTO user_notifications(notification_id,school_id,recipient_kind,recipient_id,event_key,category,title,body,action_url,read_at) VALUES($1,$2,$3,$4,$5,'SYSTEM',$6,'Sample data only','',CASE WHEN $7 THEN NOW() ELSE NULL END)",
    [id,s,k,u,'synthetic:'+id,title,isRead]);
  const hit=makeHarness(db);
  const userA={type:'SCHOOL_USER',role:'SCHOOL_ADMIN',schoolId:school1,userId:schoolUser};
  const userB={type:'SCHOOL_USER',role:'SCHOOL_ADMIN',schoolId:school2,userId:schoolUser};
  const other={type:'SCHOOL_USER',role:'TEACHER',schoolId:school1,userId:otherUser};
  const studentA={type:'STUDENT',schoolId:school1,studentAccountId:student};
  const superAdmin={type:'PLATFORM_USER',role:'SUPER_ADMIN',userId:platform};
  const list=await hit('GET','/api/notifications',userA);
  assert.equal(list.statusCode,200);
  assert.equal(list.body.notifications.length,2);
  assert.equal(list.body.unreadCount,1);
  assert.equal(list.headers['Cache-Control'],'private, no-store');
  const endpoint='/api/notifications/:id';
  const denial=[
   await hit('DELETE',endpoint,userB,{id:notices.schoolRead}),
   await hit('DELETE',endpoint,other,{id:notices.schoolRead}),
   await hit('DELETE',endpoint,studentA,{id:notices.schoolRead})
  ];
  for(const response of denial)assert.equal(response.statusCode,404);
  assert.equal((await hit('DELETE',endpoint,userA,{id:'invalid'})).statusCode,400);
  assert.equal((await hit('DELETE',endpoint,userA,{id:notices.platformRead})).statusCode,404);
  const deleted=await hit('DELETE',endpoint,userA,{id:notices.schoolRead});
  assert.equal(deleted.statusCode,200);
  assert.equal(deleted.body.deleted,1);
  assert.equal((await hit('DELETE',endpoint,userA,{id:notices.schoolRead})).statusCode,404);
  let remaining=await hit('GET','/api/notifications',userA);
  assert.equal(remaining.body.notifications.length,1);
  assert.equal(remaining.body.unreadCount,1);
  const noRead=await hit('POST','/api/notifications/delete-read',userA);
  assert.equal(noRead.statusCode,200);
  assert.equal(noRead.body.deleted,0);
  remaining=await hit('GET','/api/notifications',userA);
  assert.equal(remaining.body.unreadCount,1);
  assert.equal((await hit('PATCH','/api/notifications/:id/read',userA,{id:notices.schoolUnread})).statusCode,200);
  const cleared=await hit('POST','/api/notifications/delete-read',userA);
  assert.equal(cleared.body.deleted,1);
  assert.equal((await hit('GET','/api/notifications',userA)).body.notifications.length,0);
  assert.equal((await hit('GET','/api/notifications',userB)).body.notifications.length,1);
  assert.equal((await hit('GET','/api/notifications',other)).body.notifications.length,1);
  assert.equal((await hit('GET','/api/notifications',studentA)).body.notifications.length,1);
  const platformList=await hit('GET','/api/platform/notifications',superAdmin);
  assert.equal(platformList.body.notifications.length,2);
  assert.equal(platformList.body.unreadCount,1);
  assert.equal((await hit('POST','/api/platform/notifications/delete-read',superAdmin)).body.deleted,1);
  const platformAfter=await hit('GET','/api/platform/notifications',superAdmin);
  assert.equal(platformAfter.body.notifications.length,1);
  assert.equal(platformAfter.body.unreadCount,1);
  assert.equal((await hit('DELETE','/api/platform/notifications/:id',superAdmin,{id:notices.otherSchool})).statusCode,404);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM user_notifications')).rows[0].n,4);
  assert.equal((await hit('DELETE',endpoint,{type:'UNKNOWN'},{id:notices.otherUser})).statusCode,403);
 }finally{await db.end();}
});