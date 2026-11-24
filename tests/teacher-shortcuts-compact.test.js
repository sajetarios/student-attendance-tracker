'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync('public/'+f,'utf8');
const html=read('portal.html'),style=read('teacher-shortcuts-compact.css'),worker=read('sw.js');
const portal=read('portal.js'),teacherV2=read('teacher-dashboard-v2.js');

test('teacher shortcuts retain original navigation, roles and designated SF2 action',()=>{
  const card=html.match(/id="quickActionsCard"[\s\S]*?<\/section>/)?.[0];
  assert.ok(card,'one existing shortcuts section');
  assert.equal((html.match(/id="quickActionsCard"/g)||[]).length,1);
  assert.match(card,/class="teacher-shortcut-items" role="group" aria-label="Teaching shortcuts"/);
  for(const action of ['students','teachers','schedules','sf2']){
    assert.equal((card.match(new RegExp('data-go="'+action+'"','g'))||[]).length,1,action);
  }
  assert.match(portal,/button\.hidden = !allowed\.includes\(target\)/);
  assert.match(portal,/button\.addEventListener\('click', \(\) => setView\(button\.dataset\.go\)\)/);
  assert.match(portal,/teacher && classAdviser/);
  assert.match(portal,/teacher && target === 'students' && !classAdviser && !subjectTeacher/);
  assert.match(card,/class="scope-note"/);
  assert.doesNotMatch(style,/data-go\s*=|\/api\/|fetch\(|POST|DELETE|PUT/i);
  assert.match(teacherV2,/user\?\.role !== 'TEACHER'/);
});

test('teacher launcher uses a compact card grid with real touch targets and safe hidden controls',()=>{
  assert.match(style,/html\.attendigo-teacher-v2 body\.portal-page #quickActionsCard/);
  assert.match(style,/container-type:\s*inline-size/);
  assert.match(style,/\.teacher-shortcut-items\s*\{/);
  assert.match(style,/@container \(min-width: 730px\)/);
  assert.match(style,/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(style,/@container \(max-width: 370px\)/);
  assert.match(style,/\.quick-action\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(style,/min-height:\s*70px !important/);
  assert.match(style,/:focus-visible/);
  assert.match(style,/prefers-reduced-motion/);
  assert.match(style,/\.scope-note\s*\{\s*display:\s*none !important/);
  assert.match(style,/--shortcut-bg:\s*var\(--ui-panel/);
  assert.match(style,/html\[data-ui-theme="dark"\]/);
  assert.match(style,/\.quick-action-icon\.blue/);
});

test('portal and offline service worker load the versioned shortcut asset',()=>{
  const path='/teacher-shortcuts-compact.css?v=1';
  assert.ok(html.includes('href="'+path+'"'));
  assert.ok(worker.includes('"'+path+'"'));
  assert.ok(html.lastIndexOf(path)<html.lastIndexOf('</head>'));
  const version=Number(worker.match(/attendigo-v(\d+)-/)?.[1]);
  assert.ok(version>=332,'PWA cache must include compact teacher shortcut assets');
});
