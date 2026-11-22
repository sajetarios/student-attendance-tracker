'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const topics = require('../public/attendigo-help-topics');
const {registerHelpAiRoutes,buildInstructions} = require('../help-ai-routes');

const html = fs.readFileSync('public/portal.html','utf8');
const sw = fs.readFileSync('public/sw.js','utf8');
const client = fs.readFileSync('public/attendigo-help-guide.js','utf8');
const css = fs.readFileSync('public/attendigo-help.css','utf8');
const server = fs.readFileSync('server.js','utf8');

test('teacher guide answers live Attendigo workflows', () => {
  const answers = [
    ['How do I import SF1?', 'sf1-import'],
    ['How can I view my DTR?', 'dtr'],
    ['I want to apply for leave', 'leave'],
    ['Where is my OB request?', 'official-business'],
    ['How do I view my weekly timetable?', 'schedule'],
    ['How do I add a class schedule?', 'schedule-create'],
    ['Where is the guardian contact?', 'guardian']
  ];
  for (const [question,id] of answers) {
    const role = id === 'schedule-create' ? 'DEPARTMENT_HEAD' : 'TEACHER';
    assert.equal(topics.answer(question,role).topic?.id,id,question);
  }
  const sf1=topics.answer('Upload my SF1','TEACHER');
  assert.match(sf1.steps.join(' '), /review/i);
  const dtr=topics.answer('DTR','TEACHER');
  assert.match(dtr.steps.join(' '),/missing punch/i);
});
test('teacher questions do not reveal restricted settings or assignment guidance', () => {
  assert.equal(topics.match('school settings','TEACHER'),null);
  assert.equal(topics.match('assign teacher','TEACHER'),null);
  assert.equal(topics.match('school settings','SCHOOL_ADMIN').id,'school-settings');
  assert.equal(topics.match('assign teacher','DEPARTMENT_HEAD').id,'teacher-assignment');
  assert.ok(topics.forRole('STUDENT').length===0);
  assert.ok(topics.forRole('PARENT').length===0);
});
test('guide has no autonomous record write operations or hardcoded privileged URLs',()=>{
  assert.match(client,/window\.attendigoStaffIdentity\.then\(init\)/);
  assert.match(client,/hasSensitiveData\(question\)/);
  assert.match(client,/allowedMenu\(response\.topic\)/);
  assert.match(client,/SpeechRecognition|webkitSpeechRecognition/);
  assert.match(client,/speechSynthesis/);
  assert.match(client,/textContent = aiText/);
  assert.doesNotMatch(client,/\/api\/(?:students|attendance|staff-ob|staff-leave|gate|form48)\//);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(html,/attendigo-help-topics\.js\?v=2/);
  assert.match(html,/attendigo-help-guide\.js\?v=4/);
  assert.match(html,/attendigo-help\.css\?v=3/);
  for(const asset of ['/attendigo-help-topics.js?v=2','/attendigo-help-guide.js?v=4','/attendigo-help.css?v=3'])
    assert.ok(sw.includes(JSON.stringify(asset)), 'Offline PWA asset: '+asset);
  assert.match(sw,/attendigo-v309-guide-accuracy/);
});
test('AI endpoint is disabled until explicitly configured and is authenticated', async () => {
  const registered={get:new Map(),post:new Map()};
  const app={
    get(path,...handlers){registered.get.set(path,handlers);},
    post(path,...handlers){registered.post.set(path,handlers);}
  };
  const auth=(_req,_res,next)=>next();
  registerHelpAiRoutes(app,auth);
  assert.ok(registered.get.has('/api/help/config'));
  assert.ok(registered.post.has('/api/help/ask'));
  const get=registered.get.get('/api/help/config');
  const post=registered.post.get('/api/help/ask');
  assert.equal(get[0],auth);
  assert.equal(post[0],auth);
  const status={};
  const res={
    set(){return this;},
    status(value){status.code=value;return this;},
    json(value){status.body=value;return this;}
  };
  get[1]({auth:{type:'STUDENT',role:'STUDENT'}},res,()=>{status.called=true;});
  assert.equal(status.code,403);
  delete process.env.ATTENDIGO_HELP_AI_API_KEY;
  post[1]({auth:{type:'SCHOOL_USER',role:'TEACHER'}},res,()=>{status.called=true;});
  const req={auth:{type:'SCHOOL_USER',role:'TEACHER',schoolId:'test',userId:'teacher'},body:{question:'How do I view DTR?'}};
  await post[2](req,res);
  assert.equal(status.code,503);
  assert.match(status.body.error,/not configured/i);
});
test('AI prompt is role-scoped and contains no attendance records',()=>{
  const prompt=buildInstructions('TEACHER','Where is my DTR?');
  assert.match(prompt,/read-only/i);
  assert.match(prompt,/Never fabricate/i);
  assert.match(prompt,/View your DTR/i);
  assert.doesNotMatch(prompt,/Manage school configuration/);
  assert.match(server,/registerHelpAiRoutes\(app, authenticateSchoolClient\)/);
  assert.match(server,/microphone=\(self\)/);
});

test('animated help robot stays in sidebar Help & Support, never crowding the header or covering scan buttons',()=>{
  assert.ok(client.includes('robotMarkup()'));
  assert.ok(client.includes("document.getElementById('sidebar')"));
  assert.ok(client.includes('sidebar.append(dock)'));
  assert.ok(client.includes("make('div', 'attendigo-help-dock')"));
  assert.ok(client.includes("getElementById('sidebarBackdrop')"));
  assert.ok(!client.includes('headerActions.insertBefore'));
  assert.ok(!css.includes('.topbar-right > .attendigo-help-launcher'));
  assert.ok(css.includes('#sidebar.sidebar .attendigo-help-dock'));
  assert.ok(css.includes('position:sticky;bottom:0'));
  assert.ok(css.includes('sidebar-collapsed'));
  assert.ok(css.includes('@keyframes ah-wave'));
  assert.ok(css.includes('@keyframes ah-blink'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('max-width:700px'));
});
