'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerStudentManagementRoutes}=require('../student-management-routes');

function setup() {
  const handlers=new Map(), queries=[];
  const client={
    async query(sql) {
      queries.push(String(sql));
      if(String(sql).includes('SELECT s.student_id FROM students s'))
        return {rowCount:1,rows:[{student_id:'DEMO-G8-001'}]};
      if(String(sql).includes('SELECT 1 FROM class_adviser_assignments'))
        return {rowCount:1,rows:[{ok:true}]};
      if(String(sql).includes('SELECT school_year_id FROM school_years'))
        return {rowCount:1,rows:[{school_year_id:'school-year-1'}]};
      if(String(sql).includes('INSERT INTO student_enrollments'))
        return {rowCount:1,rows:[{student_id:'DEMO-G8-001'}]};
      return {rowCount:0,rows:[]};
    },
    release(){}
  };
  const pool={connect:async()=>client};
  const app={post:(url,...fn)=>handlers.set(url,fn.at(-1))};
  const auth={authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}};
  registerStudentManagementRoutes(app,pool,auth);
  const batch=handlers.get('/api/students/batch');
  assert.equal(typeof batch,'function');
  async function request(body,role='SCHOOL_ADMIN') {
    let status=200,reply;
    const res={status(code){status=code;return this;},json(v){reply=v;return this;}};
    await batch({
      auth:{role,schoolId:'school-1',userId:'staff-1',departmentId:'dept-1',departmentCode:'ENG',
        teacherDesignations:role==='TEACHER'?['CLASS_ADVISER']:[]},
      body:{studentIds:['DEMO-G8-001'],...body}
    },res);
    return {status,reply};
  }
  return {request,queries};
}

test('names, LRNs and guardian data cannot be copied to multiple learners',async()=>{
  const x=setup();
  for(const [action,field,value] of [
    ['UPDATE','fullName','Duplicate Name'],
    ['SET_SEX','fullName','Duplicate Name'],
    ['SET_SEX','lrn','123456789123'],
    ['SET_SEX','parentMobile','09123456789'],
    ['ASSIGN','parentName','Duplicated guardian']
  ]) {
    const response=await x.request({action,[field]:value,sex:'MALE',gradeLevel:'Grade 8',section:'Rizal - DEMO'});
    assert.equal(response.status,400, action+'/'+field);
  }
  assert.equal(x.queries.length,0,'invalid batch requests must never reach PostgreSQL');
});

test('only School Admin can activate, deactivate or archive learners',async()=>{
  for(const role of ['TEACHER','DEPARTMENT_HEAD']) {
    for(const action of ['ACTIVATE','DEACTIVATE','ARCHIVE']) {
      const x=setup(),response=await x.request({action},role);
      assert.equal(response.status,403,role+'/'+action);
      assert.equal(x.queries.length,0);
    }
  }
});

test('batch sex changes update sex only, not learner identity',async()=>{
  const x=setup();
  const result=await x.request({action:'SET_SEX',sex:'FEMALE'},'TEACHER');
  assert.equal(result.status,200);
  assert.equal(result.reply.updated,1);
  const updates=x.queries.filter(q=>q.includes('UPDATE students'));
  assert.equal(updates.length,1);
  assert.match(updates[0],/SET sex=\$3,updated_at=NOW\(\)/);
  assert.doesNotMatch(updates[0],/full_name|parent_mobile|\blrn\b/i);
  assert.ok(x.queries.includes('COMMIT'));
});

test('section assignment does not perform an identity-wide update',async()=>{
  const x=setup();
  const result=await x.request({action:'ASSIGN',gradeLevel:'Grade 8',section:'Rizal - DEMO'},'TEACHER');
  assert.equal(result.status,200);
  assert.equal(x.queries.filter(q=>q.includes('UPDATE students')).length,0);
  assert.ok(x.queries.some(q=>q.includes('INSERT INTO student_enrollments')));
});

test('batch UI shows one relevant field and safeguards per operation',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','portal.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','public','portal.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.doesNotMatch(html,/id="batchFullName"|id="batchLrn"|id="batchParentName"|id="batchParentMobile"/);
  assert.match(html,/id="studentBatchSelectedPreview"/);
  assert.match(html,/id="studentBatchAcknowledge"/);
  assert.match(html,/value="SET_SEX"/);
  assert.match(html,/id="batchSection"><option/);
  assert.match(js,/function canSelectLearnerForBatch/);
  assert.match(js,/p\.scheduleDepartmentId/);
  assert.match(server,/scheduleDepartmentId/);
  assert.match(js,/availableStudentBatchSections\(\)/);
  assert.match(js,/studentBatchChangeSummary/);
  assert.match(js,/AppDialog\.confirm\(message/);
});
