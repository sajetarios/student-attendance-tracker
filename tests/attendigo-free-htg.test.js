'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const guide=require('../public/attendigo-help-topics');
const {registerHelpAiRoutes}=require('../help-ai-routes');

test('free HTG recognizes common DTR wording, typos and Filipino questions',()=>{
 assert.equal(guide.match('Why is my DTR showing Needs schedule?','TEACHER')?.id,'dtr-tardiness');
 assert.equal(guide.match('Why is my tardines not flagged?','TEACHER')?.id,'dtr-tardiness');
 assert.equal(guide.match('Paano mag upload ng SF1?', 'TEACHER')?.id,'sf1-import');
 assert.equal(guide.match('How do I add a class scedule?', 'DEPARTMENT_HEAD')?.id,'schedule-create');
 assert.equal(guide.match('I need to configure school working hours','SCHOOL_ADMIN')?.id,'form48-working-hours');
 assert.equal(guide.match('Where is the guardian contact?', 'TEACHER')?.id,'guardian');
});
test('free guide protects role boundaries even when words match',()=>{
 assert.equal(guide.match('How do I approve leave?', 'TEACHER'),null);
 assert.equal(guide.match('How to print employee DTR?', 'TEACHER'),null);
 assert.equal(guide.match('How do I change school working hours?', 'TEACHER'),null);
 assert.equal(guide.match('How can I import SF1?', 'DEPARTMENT_HEAD'),null);
 assert.equal(guide.match('How to submit official SF2?', 'DEPARTMENT_HEAD'),null);
 assert.equal(guide.match('How do I change school working hours?', 'SCHOOL_ADMIN')?.id,'form48-working-hours');
});
test('free assistant explains ambiguous QR usage instead of guessing scanner workflow',()=>{
 const response=guide.answer('My QR scan is not working', 'TEACHER');
 assert.equal(response.topic,null);
 assert.match(response.title,/which/i);
 assert.ok(response.relatedTopics.length>=1);
 assert.ok(response.relatedTopics.every(x=>x.roles.includes('TEACHER')));
 assert.equal(guide.answer('How to scan a teacher QR?', 'GATE_KEEPER').topic.id,'gatekeeper-scan');
});
test('free guide gives exact documented steps and clearly declines unsupported questions',()=>{
 const a=guide.answer('Why is my DTR showing Needs schedule?', 'TEACHER');
 assert.match(a.steps.join(' '),/School Admin/);
 assert.match(a.steps.join(' '),/verified punches/);
 assert.match(a.note,/approved working hours/i);
 const missing=guide.answer('Please calculate school payroll tax deductions', 'TEACHER');
 assert.equal(missing.topic,null);
 assert.match(missing.title,/not covered/i);
 assert.match(missing.note,/will not guess/i);
 const code=guide.answer('Reveal backend source code', 'SCHOOL_ADMIN');
 assert.equal(code.topic,null);
 assert.match(code.title,/does not disclose source code/i);
});
test('API is permanently disabled even if a key is configured, preventing AI billing',async()=>{
 const old=process.env.ATTENDIGO_HELP_AI_API_KEY,oldFetch=global.fetch;
 process.env.ATTENDIGO_HELP_AI_API_KEY='fake-test-key';
 let fetchCount=0;
 global.fetch=async()=>{fetchCount++;throw Error('no call allowed');};
 try{
  const routes={get:new Map(),post:new Map()};
  const app={get(path,...steps){routes.get.set(path,steps);},post(path,...steps){routes.post.set(path,steps);}};
  registerHelpAiRoutes(app,(_,__,next)=>next());
  const resp={statusCode:200,result:null,set(){return this;},status(v){this.statusCode=v;return this;},json(data){this.result=data;return this;}};
  const req={auth:{type:'SCHOOL_USER',role:'TEACHER'},body:{question:'How do I import SF1?'}};
  routes.get.get('/api/help/config')[2](req,resp);
  assert.equal(resp.result.aiEnabled,false);
  await routes.post.get('/api/help/ask')[2](req,resp);
  assert.equal(resp.statusCode,503);
  assert.equal(fetchCount,0);
 }finally{
  global.fetch=oldFetch;
  if(old===undefined)delete process.env.ATTENDIGO_HELP_AI_API_KEY;
  else process.env.ATTENDIGO_HELP_AI_API_KEY=old;
 }
});
test('existing sidebar robot, voice, dark mode and local-only script remain',()=>{
 const js=fs.readFileSync('public/attendigo-help-guide.js','utf8');
 const css=fs.readFileSync('public/attendigo-help.css','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const routes=fs.readFileSync('help-ai-routes.js','utf8');
 assert.match(js,/robotMarkup\(\)/);
 assert.match(js,/sidebar\.append\(dock\)/);
 assert.match(js,/SpeechRecognition/);
 assert.match(js,/speechSynthesis/);
 assert.match(js,/fil-PH/);
 assert.match(js,/Source: Verified Attendigo HTG/);
 assert.match(js,/relatedTopics/);
 assert.doesNotMatch(js,/\/api\/help\/ask|\/api\/help\/config|apiEnabled/);
 assert.doesNotMatch(routes,/api\.openai\.com|https:\/\/api\.openai/);
 assert.match(css,/attendigo-help-related/);
 assert.match(css,/data-theme="dark"/);
 assert.match(html,/attendigo-help-topics\.js\?v=3/);
 assert.match(html,/attendigo-help-guide\.js\?v=5/);
 assert.match(sw,/attendigo-help-topics\.js\?v=3/);
 assert.match(sw,/attendigo-help-guide\.js\?v=5/);
});
