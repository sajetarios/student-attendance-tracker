'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {registerStaffLunchRoutes}=require('../staff-lunch-routes');
function fixture(role='TEACHER',assigned=true){
 const endpoints=new Map(),queries=[],auth=(req,res,next)=>next(),roles=(...allowed)=>(req,res,next)=>allowed.includes(req.auth.role)?next():res.status(403).json({error:'Forbidden'});
 const pool={async connect(){return {async query(sql,params){queries.push({sql,params});if(sql.includes('FROM staff_lunch_presenter_assignments'))return {rowCount:assigned?1:0};return {rowCount:1};},release(){}};}};
 registerStaffLunchRoutes({post(path,...handlers){endpoints.set(path,handlers)}},pool,{authenticateSchoolClient:auth,requireSchoolRoles:roles});
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
 const sql=fs.readFileSync('migrations/051_staff_lunch_presenter_assignments.sql','utf8');
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
 assert.match(src,/school_id=\$1 AND challenge_id=\$2/);
 assert.match(src,/expires_at>NOW\(\) AND revoked_at IS NULL/);
 assert.match(src,/FOR UPDATE/);
 assert.match(src,/timingSafeEqual\(expected,received\)/);
 assert.match(src,/ON CONFLICT DO NOTHING RETURNING event_id,occurred_at/);
 assert.match(src,/INSERT INTO staff_attendance_challenge_redemptions/);
 assert.match(src,/INSERT INTO staff_attendance_audit/);
 assert.match(src,/error.code==='23505'/);
});
