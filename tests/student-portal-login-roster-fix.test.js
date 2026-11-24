'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter}=require('node:events');
const { registerAuthRoutes } = require('../auth-routes');
const { hashPassword } = require('../auth-security');
const root = path.resolve(__dirname, '..');

function fixture(passwordHash) {
  const endpoints = new Map();
  const queries = [];
  const app = {
    post(route, ...handlers) { endpoints.set('POST '+route, handlers); },
    get(route, ...handlers) { endpoints.set('GET '+route, handlers); }
  };
  const pool = {
    async query(query, params = []) {
      const sql = String(query);
      queries.push({sql, params});
      if (/FROM schools WHERE lower\(school_code\)/.test(sql)) return {
        rowCount: 1, rows: [{school_id:'school-one',school_code:'DEMO001',school_name:'Demo school'}]
      };
      if (/FROM student_accounts sa/.test(sql)) return {
        rowCount: 1, rows: [{
          student_account_id:'account-one',student_id:'TEST-01',username:'TEST-01',
          password_hash:passwordHash,active:true,must_change_password:true,
          failed_login_attempts:0,locked_until:null,full_name:'Learner Test',
          grade_level:'Grade 8',section:'Rizal'
        }]
      };
      return {rowCount:1,rows:[]};
    }
  };
  registerAuthRoutes(app,pool);
  async function signIn(password) {
    const req = {path:'/api/auth/student/login',ip:'192.0.2.1',headers:{cookie:''},body:{schoolCode:'DEMO001',username:'TEST-01',password}};
    let status=200,payload;
    const res = Object.assign(new EventEmitter(),{
      statusCode:200,
      status(code) {status=code;this.statusCode=code;return this;},
      json(value) {payload=value;this.emit('finish');return this;},
      setHeader() {return this;},
      end() {this.emit('finish');return this;}
    });
    const handlers=endpoints.get('POST /api/auth/student/login');
    assert.ok(handlers,'The student sign-in route must exist');
    for(const handler of handlers) {
      if(handler.length>=3) {
        let passed=false;
        await handler(req,res,()=>{passed=true;});
        if(!passed)break;
      }else await handler(req,res);
    }
    return {status,payload};
  }
  return {signIn,queries};
}

test('invalid student password is a 401, not a generic login-service outage', async()=>{
  const correctPassword='Correct-student-pass-12345!';
  const {signIn,queries}=fixture(await hashPassword(correctPassword));
  const response=await signIn('Incorrect-student-pass-12345!');
  assert.equal(response.status,401);
  assert.match(response.payload.error,/Invalid login credentials/);
  const failedUpdate=queries.find(q=>/UPDATE student_accounts\s+SET failed_login_attempts/.test(q.sql));
  assert.ok(failedUpdate,'Failed attempts should still be recorded');
  assert.match(failedUpdate.sql,/WHERE student_account_id = \$1/);
  assert.deepEqual(failedUpdate.params,['account-one']);
  assert.equal(queries.some(q=>/INSERT INTO student_sessions/.test(q.sql)),false,'Bad password must not create a session');
});

test('valid student password issues a student-only session', async()=>{
  const correctPassword='Correct-student-pass-12345!';
  const {signIn,queries}=fixture(await hashPassword(correctPassword));
  const response=await signIn(correctPassword);
  assert.equal(response.status,200);
  assert.equal(response.payload.user.role,'STUDENT');
  assert.equal(response.payload.user.mustChangePassword,true);
  assert.ok(response.payload.accessToken);
  assert.ok(queries.some(q=>/INSERT INTO student_sessions/.test(q.sql)));
});

test('School Admin dashboard must fetch the real school roster, not an empty placeholder',()=>{
  const source=fs.readFileSync(path.join(root,'public','portal.js'),'utf8');
  assert.doesNotMatch(source,/isSchoolAdmin\s*\?\s*Promise\.resolve\(\{ students: \[\] \}\)/);
  assert.match(source,/const roster = await api\(isSchoolAdmin \? '\/api\/students\?includeInactive=true' : '\/api\/students'\)/);
  assert.match(source,/\$\('showStudentPortalHelp'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?setView\('studentAccounts'\)/);
  assert.match(source,/SCHOOL_ADMIN'\) return \['dashboard', 'students', 'studentAccounts'/);
});

test('Student roster route and account directory retain school-specific access checks',()=>{
  const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const accountRoute=fs.readFileSync(path.join(root,'student-portal-account-routes.js'),'utf8');
  assert.match(server,/app\.get\('\/api\/students', authenticateSchoolClient, requireSchoolClient, requireSchoolPermission\('students\.view\.all'\)/);
  assert.match(server,/WHERE s\.school_id=\$1/);
  assert.match(accountRoute,/const filters = \['s\.school_id=\$1', 's\.active=TRUE', 's\.archived_at IS NULL'\]/);
});
