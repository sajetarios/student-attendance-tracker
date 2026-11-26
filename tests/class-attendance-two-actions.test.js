'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=src('public/portal.html');
const js=src('public/manual-folio.js');
const sw=src('public/sw.js');

test('class attendance presents only Save Attendance and Finalize Day',()=>{
 const section=html.split('id="manualFolio"')[1].split('id="mfHistoryPanel"')[0];
 const footer=section.split('class="manual-bottom"')[1].split('</div></div>')[0];
 assert.match(footer,/id="mfSync"[^>]*>▣ Save Attendance<\/button>/);
 assert.match(footer,/id="mfFinalize"[^>]*>✓ Finalize Day<\/button>/);
 assert.doesNotMatch(section,/id="mfSave"/);
 assert.doesNotMatch(footer,/Save sheet|Sync to records/);
 assert.equal((footer.match(/<button\b/g)||[]).length,2);
});

test('marking attendance still saves a local draft automatically',()=>{
 assert.match(js,/function setMark\(id,status\)[\s\S]*?draftSave\(\);render\(\)/);
 assert.match(js,/localStorage\.setItem\(key\(\),JSON\.stringify\(\{marks:state\.marks/);
 assert.doesNotMatch(js,/el\('mfSave'\)/);
});

test('Save Attendance preserves existing authenticated sync and offline queue',()=>{
 assert.match(js,/el\('mfSync'\)\.addEventListener\('click',sync\)/);
 assert.match(js,/async function sync\(\)/);
 assert.match(js,/type:'MANUAL_MARKS',operationId,payload:/);
 assert.match(js,/await window\.AttendigoOffline\.sync\(\)/);
 assert.match(js,/if\(remaining\?\.status==='REVIEW'\)/);
 assert.match(js,/Server verification differs from your device/);
});

test('Finalize Day remains a separate audited and guarded sign-off',()=>{
 assert.match(js,/el\('mfFinalize'\)\?\.addEventListener\('click',async\(\)=>/);
 assert.match(js,/state\.finalized\?'↺ Reopen register':'✓ Finalize Day'/);
 assert.match(js,/type:'REGISTER_SIGNOFF',operationId:opId/);
 assert.match(js,/const prompt=action==='FINALIZE'/);
 const routes=src('class-finalization-routes.js');
 assert.match(routes,/Finish syncing every learner's attendance first/);
 assert.match(routes,/Resolve QR\/manual attendance conflicts before finalizing/);
 assert.match(routes,/class_attendance_finalization_events/);
});

test('PWA serves the same versioned attendance code as the portal',()=>{
 const portalVersion=html.match(/\/manual-folio\.js\?v=(\d+)/);
 const workerVersion=sw.match(/\/manual-folio\.js\?v=(\d+)/);
 assert.ok(portalVersion&&workerVersion);
 assert.equal(portalVersion[1],workerVersion[1]);
 assert.ok(Number(portalVersion[1])>=19);
});

test('interactive register renders every learner beyond the former 20-row page',()=>{
 const section=html.split('id="mfSheet"')[1].split('id="mfRight"')[0];
 assert.doesNotMatch(section,/mfPrev|mfNext|mfPageNum|Select page/);
 assert.match(section,/id="mfSelectAll"[^>]*> Select all learners/);
 const source=js.slice(js.indexOf(' function renderRows(){'),js.indexOf(' function renderDetails(){'));
 const learners=Array.from({length:45},(_,i)=>({studentId:'id'+i,fullName:'Learner '+i}));
 const controls={mfSelectAll:{},mfSelectedCount:{},mfRows:{}};
 const state={rosterView:'alphabetical',selected:new Set(['id44']),marks:{}};
 const esc=v=>String(v??'');
 const roster=()=>learners;
 const selected=id=>state.selected.has(id);
 const effectiveMark=()=>null;
 const window={AttendigoRoster:{numberLearners:list=>list.map((learner,i)=>({learner,number:i+1}))}};
 const render=new Function('window','roster','state','el','selected','esc','effectiveMark','names',source+';return renderRows;')(window,roster,state,id=>controls[id],selected,esc,effectiveMark,{});
 render();
 assert.equal((controls.mfRows.innerHTML.match(/data-select=/g)||[]).length,45);
 assert.match(controls.mfRows.innerHTML,/data-select="id44" checked/);
 assert.equal(controls.mfSelectAll.checked,false);
 assert.equal(controls.mfSelectAll.indeterminate,true);
 state.selected=new Set(learners.map(s=>s.studentId));render();
 assert.equal(controls.mfSelectAll.checked,true);
 assert.equal(controls.mfSelectAll.indeterminate,false);
 const selectHandler=js.match(/if\(event\.target\.id==='mfSelectAll'\)\{([^\n]+)\}/)[1];
 const selectAll=new Function('event','roster','state','renderRows',selectHandler);
 selectAll({target:{checked:false}},roster,state,render);
 assert.equal(state.selected.size,0);
 selectAll({target:{checked:true}},roster,state,render);
 assert.equal(state.selected.size,45);
 assert.match(js,/mfHistoryPrev/);
 assert.match(js,/data-conflict-page/);
});
