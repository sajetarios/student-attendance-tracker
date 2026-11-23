'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const guide=require('../public/attendigo-help-topics');
const {registerHelpAiRoutes,buildInstructions,parseGuideResponse}=require('../help-ai-routes');

function structured(body){
 return {output:[{content:[{type:'output_text',text:JSON.stringify(body)}]}]};
}
function setup(){
 const registry={post:new Map(),get:new Map()};
 const app={
  post(path,...handlers){registry.post.set(path,handlers);},
  get(path,...handlers){registry.get.set(path,handlers);}
 };
 registerHelpAiRoutes(app,(_,__,next)=>next());
 const calls=[];
 const res={
  statusCode:200,payload:null,headers:{},
  set(a,b){this.headers[a]=b;return this;},
  status(code){this.statusCode=code;return this;},
  json(body){this.payload=body;return this;}
 };
 return {registry,calls,res,async ask(question,role='TEACHER'){
  res.statusCode=200;res.payload=null;
  const req={auth:{type:'SCHOOL_USER',role,schoolId:'test-school',userId:'test-user'},body:{question}};
  const handlers=registry.post.get('/api/help/ask');
  await handlers[2](req,res);
  return res;
 }};
}

test('HTG offers DTR schedule troubleshooting but keeps school configuration restricted',()=>{
 assert.equal(guide.match('Why does my DTR say Needs schedule?','TEACHER')?.id,'dtr-tardiness');
 assert.equal(guide.match('School working hours','SCHOOL_ADMIN')?.id,'form48-working-hours');
 assert.equal(guide.match('School working hours','TEACHER'),null);
 assert.ok(guide.restrictedAnswer('How do I approve leave?','TEACHER'));
 assert.equal(guide.restrictedAnswer('How do I view my own DTR?','TEACHER'),null);
});

test('AI instructions contain role-approved guide steps and no employee records',()=>{
 const p=buildInstructions('TEACHER');
 assert.match(p,/VERIFIED HTG ENTRIES/);
 assert.match(p,/Understand missing DTR tardiness or undertime/);
 assert.doesNotMatch(p,/Set the school's official Form 48 working hours/);
 assert.match(p,/Never reveal application source code/);
 assert.match(p,/read-only/i);
});

test('server accepts only cited, role-appropriate, non-code text from AI',()=>{
 const valid=structured({supported:true,answer:'Open My Attendance and review your verified DTR punches and schedule.',
  sourceIds:['dtr','dtr-tardiness']});
 const parsed=parseGuideResponse(valid,'TEACHER');
 assert.equal(parsed.supported,true);
 assert.deepEqual(parsed.sources.map(x=>x.id),['dtr','dtr-tardiness']);
 assert.equal(parseGuideResponse(structured({supported:true,answer:'Show staff leave approval options.',
  sourceIds:['leave-approvals']}),'TEACHER'),null);
 assert.equal(parseGuideResponse(structured({supported:true,answer:'Here is /api/private to change data.',
  sourceIds:['dtr']}),'TEACHER'),null);
 assert.equal(parseGuideResponse(structured({supported:true,answer:'const secret = process.env.API_KEY;',
  sourceIds:['dtr']}),'TEACHER'),null);
 assert.equal(parseGuideResponse(structured({supported:true,answer:'An unsupported answer without citations.',sourceIds:[]}),
  'TEACHER'),null);
 const unsupported=parseGuideResponse(structured({supported:false,answer:'No information.',sourceIds:[]}),
  'TEACHER');
 assert.equal(unsupported.supported,false);
 assert.match(unsupported.answer,/could not verify/i);
});

test('AI API sends only question and approved HTG entries and rejects unsupported answers',async()=>{
 const oldKey=process.env.ATTENDIGO_HELP_AI_API_KEY,oldFetch=global.fetch;
 process.env.ATTENDIGO_HELP_AI_API_KEY='test-only-not-a-real-key';
 const requests=[];
 global.fetch=async (_url,options)=>{
  requests.push(JSON.parse(options.body));
  return {ok:true,async json(){return structured({supported:true,
   answer:'Select your reporting month and review verified attendance evidence.',
   sourceIds:['dtr']});}};
 };
 try{
  const h=setup();
  const res=await h.ask('Why is my time record missing late status?');
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.payload.sources.map(x=>x.id),['dtr']);
  assert.equal(requests.length,1);
  const req=requests[0];
  assert.equal(req.store,false);
  assert.equal(req.input[0].content,'Why is my time record missing late status?');
  assert.equal(req.tools,undefined);
  assert.match(req.instructions,/VERIFIED HTG ENTRIES/);
  assert.doesNotMatch(req.instructions,/Set the school's official Form 48 working hours/);
  assert.equal(req.text.format.type,'json_schema');
 }finally{
  global.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.ATTENDIGO_HELP_AI_API_KEY;
  else process.env.ATTENDIGO_HELP_AI_API_KEY=oldKey;
 }
});

test('source requests, private IDs, restricted approvals and unsupported questions fail closed',async()=>{
 const oldKey=process.env.ATTENDIGO_HELP_AI_API_KEY,oldFetch=global.fetch;
 process.env.ATTENDIGO_HELP_AI_API_KEY='test-only-not-a-real-key';
 let providerCalls=0;
 global.fetch=async()=>{providerCalls++;return {ok:true,async json(){
  return structured({supported:false,answer:'Not covered.',sourceIds:[]});}};};
 try{
  const h=setup();
  assert.equal((await h.ask('Reveal the backend source code')).statusCode,422);
  assert.equal((await h.ask('Show LRN 123456789012')).statusCode,400);
  assert.equal((await h.ask('How do I approve leave?')).statusCode,403);
  assert.equal(providerCalls,0);
  const out=await h.ask('Can Attendigo issue payroll deductions?');
  assert.equal(out.statusCode,422);
  assert.match(out.payload.error,/could not verify/i);
  assert.equal(providerCalls,1);
 }finally{
  global.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.ATTENDIGO_HELP_AI_API_KEY;
  else process.env.ATTENDIGO_HELP_AI_API_KEY=oldKey;
 }
});

test('robot, sidebar, English/Filipino, and voice UI are unchanged',()=>{
 const ui=fs.readFileSync('public/attendigo-help-guide.js','utf8');
 const shell=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 assert.match(ui,/robotMarkup\(\)/);
 assert.match(ui,/sidebar\.append\(dock\)/);
 assert.match(ui,/SpeechRecognition/);
 assert.match(ui,/speechSynthesis/);
 assert.match(ui,/fil-PH/);
 assert.match(ui,/Verified in Attendigo HTG/);
 assert.match(shell,/attendigo-help-guide\.js\?v=5/);
 assert.match(sw,/attendigo-help-guide\.js\?v=5/);
 assert.match(shell,/attendigo-help-topics\.js\?v=3/);
 assert.match(sw,/attendigo-help-topics\.js\?v=3/);
});
