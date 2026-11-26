'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const staff=read('portal.html'),js=read('attendigo-role-workspaces.js');
function styles(source){return [...source.split('</head>')[0].matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]?read(m[1]):m[2]);}
function slice(source,start,end){const i=source.indexOf(start),j=source.indexOf(end,i);assert.ok(i>=0&&j>i,start);return source.slice(i,j+end.length);}
const menuSource=read('portal.js');
const menuStart=menuSource.indexOf('    // V5.5: prioritize daily tasks');
const menuEnd=menuSource.indexOf('    // Visibility is recalculated AFTER relocation',menuStart);
assert.ok(menuStart>=0&&menuEnd>menuStart);
const menuCode=menuSource.slice(menuStart,menuEnd);
const nav=slice(staff,'<aside class="sidebar"','</aside>');
const intro=slice(staff,'<header class="ax-workspace-intro"','</header>');
const scanner=fullSection(staff,'studentScannerCard');
function fullSection(source,id){
 const i=source.indexOf('<section id="'+id+'"');assert.ok(i>=0,id);
 let depth=0;
 for(const match of source.slice(i).matchAll(/<\/?section\b[^>]*>/gi)){
  depth+=match[0].startsWith('</')?-1:1;
  if(depth===0)return source.slice(i,i+match.index+match[0].length);
 }
 throw Error('Unbalanced section '+id);
}
const dashboards=['adminDashboardCard','departmentHeadOverview'].map(id=>fullSection(staff,id));
const roles={SCHOOL_ADMIN:'School operations',DEPARTMENT_HEAD:'Department priorities',TEACHER:'My teaching day',GATE_KEEPER:'Gate verification'};
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{
  for(const role of Object.keys(roles))for(const width of [320,390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<800,isMobile:width<800});
   try{
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="portal-page"><div class="portal-layout" data-attendigo-role="'+role+'">'+nav+'<main class="main-area content-wrap"><div id="dashboardView">'+intro+'<div id="auxiliary">Auxiliary</div>'+dashboards.join('')+'</div>'+scanner+'</main></div></body></html>');
    // Use the same network-independent stylesheet injection as the existing WebKit suite.
    await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles(staff).map(css=>css.replace(/@import\s+[^;]+;/g,'')));
    await page.evaluate(role=>{document.querySelector('#sidebar').classList.add('open');document.querySelector('.portal-layout').removeAttribute('data-attendigo-role');window.attendigoStaffIdentity=Promise.resolve({role});},role);
    const hiddenBefore=await page.locator('#sidebar [hidden]').count();
    if(role!=='GATE_KEEPER'){
     const before=await page.locator('#sidebar .nav-item').evaluateAll(nodes=>nodes.map(n=>[n.id,n.getAttribute('href'),n.hidden]).sort());
     await page.addScriptTag({content:'(()=>{const $=id=>document.getElementById(id);const teacher='+String(role==='TEACHER')+',departmentHead='+String(role==='DEPARTMENT_HEAD')+',admin='+String(role==='SCHOOL_ADMIN')+';'+menuCode+'})();'});
     const first=await page.locator('#sidebar .side-nav > *').evaluateAll(nodes=>nodes.slice(0,3).map(n=>n.id));
     assert.deepEqual(first,role==='SCHOOL_ADMIN'?['dashboardNav','attendanceManagementNavGroup','academicNavigationGroup']:role==='DEPARTMENT_HEAD'?['dashboardNav','studentRecordsNavGroup','operationsNavGroup']:['dashboardNav','studentRecordsNavGroup','personalAttendanceNavGroup']);
     assert.deepEqual(await page.locator('#sidebar .nav-item').evaluateAll(nodes=>nodes.map(n=>[n.id,n.getAttribute('href'),n.hidden]).sort()),before,'menu reordering must preserve every route and hidden state');
    }
    await page.addScriptTag({content:js});
    await page.evaluate(role=>{document.querySelector('.portal-layout').setAttribute('data-attendigo-role',role);document.dispatchEvent(new Event('attendigo:portal-ready'));},role);
    await page.waitForFunction(title=>document.getElementById('axStaffDashboardTitle').textContent===title,roles[role]);
    assert.equal(await page.locator('#sidebar [hidden]').count(),hiddenBefore,'role visibility must be unchanged');
    assert.equal(await page.locator('#sidebar #academicAdminNav').getAttribute('hidden'),'');
    assert.equal(await page.locator('#axSignatureDock [data-target="academicAdminNav"]').count(),0,'hidden enrollment must not appear in dock');
    assert.equal(await page.locator('#axSignatureDock [data-target="sidebarToggle"]').count(),1);
    const id=role==='SCHOOL_ADMIN'?'adminDashboardCard':role==='DEPARTMENT_HEAD'?'departmentHeadOverview':null;
    if(id)assert.equal(await page.locator('#axStaffDashboardIntro + *').getAttribute('id'),id);
    if(role==='GATE_KEEPER')assert.equal(await page.locator('#studentScannerCard').getAttribute('data-ax-gate-workspace'),'true');
    if(role!=='GATE_KEEPER'){
     // Run the real legacy workspace script after the original role renderer,
     // just as production does. Verify the final menu, not an intermediate state.
     await page.addScriptTag({content:read('simplified-workspace.js')});
     await page.evaluate(()=>document.dispatchEvent(new Event('attendigo:portal-ready')));
     await page.waitForFunction(()=>document.querySelector('#sidebar .side-nav')?.dataset.axMenuOrganization==='v56');
     const finalOrder=await page.locator('#sidebar .side-nav > *').evaluateAll(nodes=>nodes.slice(0,3).map(n=>n.id));
     assert.deepEqual(finalOrder,role==='SCHOOL_ADMIN'?['dashboardNav','attendanceManagementNavGroup','academicNavigationGroup']:role==='DEPARTMENT_HEAD'?['dashboardNav','studentRecordsNavGroup','operationsNavGroup']:['dashboardNav','studentRecordsNavGroup','personalAttendanceNavGroup']);
     assert.equal(await page.locator('#sidebar #academicAdminNav').getAttribute('hidden'),'');
     assert.equal(await page.locator('#simpleNavSearch').count(),1);
    }
    // Verify the help dock shares the school-colored sidebar on light and dark branding.
    await page.evaluate(()=>{const dock=document.createElement('div');dock.className='attendigo-help-dock';dock.innerHTML='<span class="attendigo-help-dock-title">Help &amp; Support</span><button class="attendigo-help-launcher">Ask Attendigo</button>';document.querySelector('#sidebar').append(dock);});
    for(const [bg,ink] of [['#064324','#ffffff'],['#c8f29b','#101827']]){
     const help=await page.evaluate(([bg,ink])=>{document.documentElement.style.setProperty('--ap-nav',bg);document.documentElement.style.setProperty('--ap-nav-ink',ink);const dock=document.querySelector('.attendigo-help-dock'),button=dock.querySelector('button');return {dock:getComputedStyle(dock).backgroundColor,button:getComputedStyle(button).backgroundColor,image:getComputedStyle(button).backgroundImage,ink:getComputedStyle(button).color};},[bg,ink]);
     assert.equal(help.dock,'rgba(0, 0, 0, 0)');assert.equal(help.button,'rgba(0, 0, 0, 0)');assert.equal(help.image,'none');assert.equal(help.ink,ink==='#ffffff'?'rgb(255, 255, 255)':'rgb(16, 24, 39)');
    }
    if(role==='TEACHER'){
     await page.evaluate(()=>{const section=document.createElement('section');section.id='schedulesView';section.innerHTML='<div id="weeklyTimetableBoard" class="weekly-timetable-board"></div>';document.querySelector('.main-area').append(section);});
     await page.addScriptTag({content:read('timetable-grid.js')});
     await page.evaluate(()=>{const days=[1,2,3,4,5];window.TimetableGrid.render({host:document.querySelector('#weeklyTimetableBoard'),days,weekdayDates:{1:'2026-11-23',2:'2026-11-24',3:'2026-11-25',4:'2026-11-26',5:'2026-11-27'},entries:days.map(dayIndex=>({dayIndex,date:'2026-11-26',startTime:'16:15',endTime:'17:15',subjectName:'English Language and Communication',gradeLevel:'Grade 7',section:'B',teacherScheduleView:true,isMySubjectClass:true,isMyAdvisorySection:true}))});});
     const grid=await page.evaluate(()=>{const board=document.querySelector('#weeklyTimetableBoard'),scroll=board.querySelector('.tt-grid-scroll'),headers=[...board.querySelectorAll('thead th')],cells=[...board.querySelectorAll('.tt-class-cell')],cards=[...board.querySelectorAll('.tt-subject')],rect=n=>n.getBoundingClientRect();return {headers:headers.length,headDisplay:getComputedStyle(board.querySelector('thead')).display,cellDisplay:getComputedStyle(cells[0]).display,distinctX:new Set(cells.map(n=>Math.round(rect(n).left))).size,overlap:cards.some(n=>[...n.querySelectorAll('span')].some(s=>rect(s).bottom>rect(n).bottom+1)),scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth};});
     assert.equal(grid.headers,6);assert.equal(grid.headDisplay,'table-header-group');assert.equal(grid.cellDisplay,'table-cell');assert.equal(grid.distinctX,5);assert.equal(grid.overlap,false);if(width<800)assert.ok(grid.scrollWidth>grid.clientWidth,JSON.stringify(grid));
    }
    const result=await page.locator('#axStaffDashboardIntro').evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth}));
    assert.ok(result.height>0&&result.width>0&&result.scroll<=result.client+1,'workspace intro overflow '+role+' '+width+' '+JSON.stringify(result));
   }finally{await page.close();}
  }
  for(const [name,selector] of [['principal.html','.principal-navigation'],['student-portal.html','.student-header'],['parent-portal.html','.parent-head']]){
   const source=read(name);
   const markup=name==='principal.html'?slice(source,'<nav class="principal-navigation"','</nav>'):name==='student-portal.html'?slice(source,'<header class="student-header"','</header>'):slice(source,'<header class="parent-head"','</header>');
   for(const width of [320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<800,isMobile:width<800});
    try{
     await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="portal-page"><main id="main" style="width:100%;box-sizing:border-box">'+markup+'</main></body></html>');
     // Use the same network-independent stylesheet injection as the existing WebKit suite.
    await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles(source).map(css=>css.replace(/@import\s+[^;]+;/g,'')));
     const b=await page.locator(selector).evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,width:e.getBoundingClientRect().width}));
     assert.ok(b.width>0&&b.scroll<=b.client+1,name+' header overflow '+width);
    }finally{await page.close();}
   }
  }
  console.log(engine.name()+' seven-role real navigation/header markup geometry and role-preserving presentation checks passed');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
