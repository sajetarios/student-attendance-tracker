const test=require('node:test');
const assert=require('node:assert/strict');
const {classify,classifyGit}=require('../scripts/classify-release-scope.cjs');
const entry=path=>({path,status:'M',oldMode:'100644',newMode:'100644'});
const css=entry('public/principal-dashboard.css');
const html=entry('public/principal.html');
const sw=entry('public/sw.js');
const read=values=>path=>values[path]||[];
test('existing CSS and matching CSS-only cache metadata can use the scoped lane',()=>{
  assert.equal(classify([css],read({})),true);
  assert.equal(classify([css,html,sw],read({
    [html.path]:['<link rel="stylesheet" href="/principal-dashboard.css?v=17">','<link rel="stylesheet" href="/principal-dashboard.css?v=18">'],
    [sw.path]:['const CACHE = "attendigo-v467-old";\n"/principal-dashboard.css?v=17",','const CACHE = "attendigo-v468-new";\n"/principal-dashboard.css?v=18",']
  })),true);
});
test('executable, permission, schema, test, dependency and workflow changes always require full coverage',()=>{
  for(const path of ['public/principal-dashboard.js','role-permissions.js','server.js','migrations/001.sql','package-lock.json','tests/principal-dashboard.test.js','.github/workflows/release-scope.yml','scripts/classify-release-scope.cjs']){
    assert.equal(classify([css,entry(path)],read({})),false,path);
  }
  assert.equal(classify([css,html],read({[html.path]:['<button>Approve</button>','<button hidden>Approve</button>']})),false);
  assert.equal(classify([css,sw],read({[sw.path]:['"/app.js?v=1"','"/app.js?v=2"']})),false);
  assert.equal(classify([css,html],read({[html.path]:['href="/other.css?v=1"','href="/other.css?v=2"']})),false);
  assert.equal(classify([css,sw],read({[sw.path]:['const CACHE = "attendigo-v467-old";','const CACHE = "attendigo-v468-new";\nfetch("/api/attendance");']})),false);
});
test('missing, empty, new, deleted, nonregular and nonproduction changes fail closed',()=>{
  assert.equal(classify([],read({})),false);
  assert.equal(classify([html],read({})),false);
  for(const status of ['A','D','R100','T'])assert.equal(classify([{...css,status}],read({})),false);
  assert.equal(classify([{...css,newMode:'120000'}],read({})),false);
  assert.equal(classify([css,html],read({})),false);
  assert.equal(classifyGit({EVENT:'workflow_dispatch'}),false);
  assert.equal(classifyGit({EVENT:'push',REF:'refs/heads/staging/school-day-dry-run-20261120'}),false);
  assert.equal(classifyGit({EVENT:'pull_request',BASE_REF:'fix/render-login-landing'}),false);
});
