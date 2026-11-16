'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validFeatures,validLimits,FEATURE_KEYS}=require('../platform-plan-routes');
const {requireSchoolFeature}=require('../school-feature-guard');
test('plan validation rejects unknown feature keys and malformed values',()=>{
 assert.equal(validFeatures({planner:true}),true);
 assert.equal(validFeatures({planner:'yes'}),false);
 assert.equal(validFeatures({unknown:true}),false);
 assert.equal(validFeatures([]),false);
 assert.ok(FEATURE_KEYS.includes('sms_notifications'));
 assert.equal(validLimits({students:2000,sms_monthly:0}),true);
 assert.equal(validLimits({students:-1}),false);
 assert.equal(validLimits({students:1.2}),false);
});
function runGuard(row,feature='planner'){
 const pool={query:async()=>({rowCount:row?1:0,rows:row?[row]:[]})};
 const req={auth:{schoolId:'school'}};
 let status=200,body=null,passed=false;
 const res={status(v){status=v;return this},json(v){body=v;return this}};
 return requireSchoolFeature(pool,feature)(req,res,()=>{passed=true}).then(()=>({status,body,passed}));
}
test('unassigned schools keep legacy access',async()=>assert.equal((await runGuard(null)).passed,true));
test('disabled feature is denied',async()=>assert.equal((await runGuard({features:{planner:false},overrides:{},status:'ACTIVE'})).status,403));
test('override enables a disabled feature',async()=>assert.equal((await runGuard({features:{planner:false},overrides:{planner:true},status:'ACTIVE'})).passed,true));
test('override restricts an included feature',async()=>assert.equal((await runGuard({features:{planner:true},overrides:{planner:false},status:'ACTIVE'})).status,403));
test('expired subscription denies gated features',async()=>assert.equal((await runGuard({features:{planner:true},overrides:{},status:'EXPIRED'})).status,403));
