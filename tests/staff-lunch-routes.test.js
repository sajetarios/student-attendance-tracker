'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {registerStaffLunchRoutes}=require('../staff-lunch-routes');
function fixture(role='TEACHER',assigned=true){
 const endpoints=new Map(),queries=[],auth=(req,res,next)=>next(),roles=(...allowed)=>(req,res,next)=>allowed.includes(req.auth.role)?next():res.status(403).json({error:'Forbidden'});
 const pool={async connect(){return {async query(sql,params){queries.push({sql,params});if(sql.includes('FROM staff_lunch_presenter_assignments'))return {rowCount:assigned?1:0,rows:assigned?[{}]:[]};if(sql.includes('SELECT issued_at FROM staff_attendance_challenges'))return {rowCount:0,rows:[]};return {rowCount:1,rows:[]};},release(){}};}};
 registerStaffLunchRoutes({post(path,...handlers){endpoints.set(path,handlers)},get(path,...handlers){endpoints.set(path,handlers)},put(path,...handlers){endpoints.set(path,handlers)},delete(path,...handlers){endpoints.set(path,handlers)}},pool,{authenticateSchoolClient:auth,requireSchoolRoles:roles});
 const response={code:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 const req={body:{slot:'AM_OUT'},auth:{type:'SCHOOL_USER',role,schoolId:'school-a',userId:'teacher-a'}};
 return {handlers:endpoints.get('/api/staff-attendance/lunch/challenges'),req,response,queries};
}
async function execute(f){let next;for(const handler of f.handlers){if(f.response.body)break;let called=false;await handler(f.req,f.response,()=>{called=true});if(!called)break;}return f.response;}
test('issuance requires school staff role and rejects unsupported slots',async()=>{
 const f=fixture();f.req.body.slot='AM_IN';assert.equal((await execute(f)).code,400);assert.equal(f.queries.length,0);
 const student=fixture('STUDENT');assert.equal((await execute(student)).code,403);assert.equal(student.queries.length,0);
});
test('unassigned teachers cannot issue lunch challenges or persist audit rows',async()=>{
 const f=fixture('TEACHER',false),res=await execute(f);
 assert.equal(res.code,403);
 assert.ok(f.queries.some(q=>q.sql==='ROLLBACK'));
 assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_challenges')));
});
test('authorized issuance stores only hash and commits audit before returning token',async()=>{
 const f=fixture(),res=await execute(f);
 assert.equal(res.code,201);
 assert.equal(res.headers['Cache-Control'],'no-store, private');
 assert.equal(res.body.slot,'AM_OUT');
 const challenge=f.queries.find(q=>q.sql.includes('INSERT INTO staff_attendance_challenges'));
 assert.ok(challenge);
 assert.equal(challenge.params[1],'school-a');
 assert.equal(challenge.params[2],'teacher-a');
 assert.notEqual(challenge.params[5],res.body.token);
 assert.equal(challenge.params[5].length,64);
 assert.ok(f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_audit')));
 assert.equal(f.queries.at(-1).sql,'COMMIT');
 assert.ok(!JSON.stringify(f.queries).includes(res.body.token));
});
test('presenter migration restricts school, slot and active assignment',()=>{
 const sql=fs.readFileSync('migrations/052_staff_lunch_presenter_assignments.sql','utf8');
 assert.match(sql,/FOREIGN KEY\(school_id,presenter_user_id\)/);
 assert.match(sql,/WHERE revoked_at IS NULL/);
 assert.match(sql,/UNIQUE INDEX staff_lunch_one_active_presenter_per_slot/);
});

test('redeem endpoint requires staff session and rejects malformed QR before querying database',async()=>{
 const f=fixture();
 const redeem=f.handlers; // issuer fixture does not expose redemption handler
 assert.ok(redeem);
 const src=fs.readFileSync('staff-lunch-routes.js','utf8');
 assert.match(src,/app.post\('\/api\/staff-attendance\/lunch\/redeem'/);
 assert.match(src,/requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'\)/);
 assert.match(src,/req.auth.userId/);
 assert.doesNotMatch(src,/req.body.staffUserId/);
});
test('redeem uses transaction, tenant-bound challenge lookup and constant-time token comparison',()=>{
 const src=fs.readFileSync('staff-lunch-routes.js','utf8');
 assert.match(src,/c.school_id=\$1 AND c.challenge_id=\$2/);
 assert.match(src,/c.expires_at>NOW\(\)-INTERVAL '90 seconds'/);
 assert.match(src,/FOR UPDATE/);
 assert.match(src,/timingSafeEqual\(expected,received\)/);
 assert.match(src,/ON CONFLICT DO NOTHING RETURNING event_id,occurred_at/);
 assert.match(src,/INSERT INTO staff_attendance_challenge_redemptions/);
 assert.match(src,/INSERT INTO staff_attendance_audit/);
 assert.match(src,/error.code==='23505'/);
});

function redemptionFixture({role='TEACHER',school='school-a',tokenValid=true,duplicate=false,expired=false}={}){
 const {createLunchChallenge}=require('../staff-lunch-challenge');
 const {manilaDate}=require('../staff-lunch-routes');
 const challenge=createLunchChallenge({slot:'AM_OUT'});
 const challengeId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const queries=[],routes=new Map();
 const pool={async connect(){return {async query(sql,params){
  queries.push({sql,params});
  if(sql.trimStart().startsWith('SELECT c.challenge_id,c.dtr_slot'))return {rowCount:expired?0:1,rows:expired?[]:[{
   challenge_id:challengeId,dtr_slot:'AM_OUT',school_date:manilaDate(),challenge_hash:challenge.challengeHash,
   issued_at:challenge.issuedAt,expires_at:challenge.expiresAt,revoked_at:null,
   presenter_user_id:'presenter-a',presenter_role:'SCHOOL_ADMIN',department_id:'department-a'
  }]};
  if(sql.includes('SELECT verification_status FROM staff_attendance_events'))return {
    rowCount:duplicate?1:0,rows:duplicate?[{verification_status:'VERIFIED'}]:[]};
  if(sql.includes('SELECT setting_value AS point FROM school_settings'))return {
    rowCount:1,rows:[{point:{latitude:9,longitude:125,radiusMeters:120}}]};
  if(sql.includes('SELECT 1 FROM staff_form48_approved_leaves'))return {rowCount:0,rows:[]};
  if(sql.includes('INSERT INTO staff_attendance_events'))return {
    rowCount:1,rows:[{event_id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',occurred_at:new Date()}]};
  return {rowCount:1,rows:[]};
 },release(){}};}};
 const auth=(req,res,next)=>next();
 const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.auth.role)?next():res.status(403).json({error:'Forbidden'});
 registerStaffLunchRoutes({post(path,...handlers){routes.set(path,handlers)},get(path,...handlers){routes.set(path,handlers)},put(path,...handlers){routes.set(path,handlers)},delete(path,...handlers){routes.set(path,handlers)}},pool,{authenticateSchoolClient:auth,requireSchoolRoles:roles});
 const req={auth:{type:'SCHOOL_USER',role,schoolId:school,userId:'teacher-a'},body:{challengeId,token:tokenValid?challenge.token:createLunchChallenge({slot:'AM_OUT'}).token,location:{latitude:9,longitude:125,accuracyMeters:10,capturedAt:Date.now()}}};
 const response={code:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 return {handlers:routes.get('/api/staff-attendance/lunch/redeem'),req,response,queries};
}
test('redemption commits verified DTR, one redemption and audit atomically',async()=>{
 const f=redemptionFixture(),res=await execute(f);
 assert.equal(res.code,201);
 assert.equal(res.body.status,'VERIFIED');
 const event=f.queries.find(q=>q.sql.includes('INSERT INTO staff_attendance_events'));
 assert.equal(event.params[1],'school-a');
 assert.equal(event.params[2],'teacher-a');
 assert.ok(f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_challenge_redemptions')));
 assert.ok(f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_audit')));
 assert.equal(f.queries.at(-1).sql,'COMMIT');
});
test('wrong token and duplicate verified slot roll back without audit or redemption',async()=>{
 for(const options of [{tokenValid:false},{duplicate:true},{expired:true}]){
  const f=redemptionFixture(options),res=await execute(f);
  assert.equal(res.code,options.duplicate?409:options.expired?410:403);
  assert.equal(f.queries.at(-1).sql,'ROLLBACK');
  assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_audit')));
  assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_challenge_redemptions')));
 }
});
test('redemption rejects student and invalid challenge IDs without database access',async()=>{
 const student=redemptionFixture({role:'STUDENT'});
 assert.equal((await execute(student)).code,403);
 assert.equal(student.queries.length,0);
 const invalid=redemptionFixture();
 invalid.req.body.challengeId='invalid';
 assert.equal((await execute(invalid)).code,400);
 assert.equal(invalid.queries.length,0);
});

test('database insert rechecks challenge validity against database clock to prevent expiry race',async()=>{
 const f=redemptionFixture(),res=await execute(f);
 assert.equal(res.code,201);
 const insert=f.queries.find(q=>q.sql.includes('INSERT INTO staff_attendance_events'));
 assert.match(insert.sql,/WHERE EXISTS \(/);
 assert.match(insert.sql,/school_id=\$2 AND challenge_id=\$9/);
 assert.match(insert.sql,/issued_at<=NOW\(\)/);
 assert.match(insert.sql,/expires_at>NOW\(\)-INTERVAL '90 seconds'/);
 assert.match(insert.sql,/ON CONFLICT DO NOTHING/);
 assert.equal(insert.params[8],f.req.body.challengeId);
});

test('missing department location produces a reviewable scan, never a verified DTR',async()=>{
 const f=redemptionFixture();
 f.req.body.location=null;
 const res=await execute(f);
 assert.equal(res.code,201);
 assert.equal(res.body.status,'PENDING_VERIFICATION');
 const insert=f.queries.find(q=>q.sql.includes('INSERT INTO staff_attendance_events'));
 assert.equal(insert.params[5],'PENDING_VERIFICATION');
 assert.equal(insert.params[6],null);
 assert.ok(f.queries.some(q=>q.sql.includes('INSERT INTO staff_attendance_audit')));
});
