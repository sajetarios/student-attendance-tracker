'use strict';
// Browser-level layout regression on representative, synthetic portal markup.
// No user accounts, personal records, backend requests or production credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const dir=path.join(__dirname,'..','public');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
function styles(name){
 const head=read(name).split('</head>')[0];
 return [...head.matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map(m=>m[1]?read(m[1]):m[2]);
}
const metric='<div class="admin-command-metric"><span class="admin-metric-icon" aria-hidden="true">🎓</span><span>Active student records</span><strong>28</strong><small>Current authorized school roster</small></div>';
const action='<details class="student-actions-dropdown"><summary>Actions</summary><div class="student-row-actions"><button class="outline-button">Learner &amp; family details</button><button class="outline-button">View QR</button></div></details>';
const roster='<section id="studentsView"><div id="studentRosterPanel"><div class="table-scroll"><table id="studentRosterTable" class="roster-mobile-compact"><thead><tr><th>Select</th><th>Photo</th><th>Full name</th><th>Student ID</th><th>Actions</th></tr></thead><tbody><tr data-student-enrollment="fixture"><td data-label="Select"><input type="checkbox" aria-label="Select learner"></td><td data-label="Photo"><span class="student-initials-avatar">AB</span></td><td data-label="Full name"><span class="student-roster-name-block"><strong>Long Compound Surname</strong><span>Sample Learner Name</span></span><div class="roster-mobile-summary"><span class="roster-mobile-class">Grade 10 · A long section name</span><span class="roster-mobile-status">Active</span><details class="roster-mobile-details"><summary>Details</summary><dl><dt>Student ID</dt><dd>26-00001</dd><dt>Special program</dt><dd>Special Program in Journalism</dd></dl></details></div></td><td data-label="Student ID">26-00001</td><td data-label="Actions">'+action+'</td></tr></tbody></table></div></div></section>';
const form='<section class="surface-card"><div class="section-toolbar"><div><h3>Attendance review</h3><p>Review attendance for the selected date.</p></div><button class="primary-button">Apply changes to attendance</button></div><form class="form-grid"><div class="field-group"><label for="day">Attendance date</label><input id="day" type="date"></div><div class="field-group"><label for="choice">Department</label><select id="choice"><option>A long department name</option></select></div><div class="form-actions"><button type="button" class="primary-button">Save attendance changes</button><button type="button" class="outline-button">Cancel and return</button></div></form></section>';
async function box(page,selector){const b=await page.locator(selector).first().boundingBox();assert.ok(b,selector+' is visible');return b;}
function overlap(a,b){return a.x<b.x+b.width-.5&&b.x<a.x+a.width-.5&&a.y<b.y+b.height-.5&&b.y<a.y+a.height-.5;}
async function contained(page,child,parent){const a=await box(page,child),b=await box(page,parent);assert.ok(a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1,child+' exceeds '+parent);}
async function setup(page,name,body,attrs='',classes='portal-page'){
 await page.setContent('<!doctype html><html '+attrs+'><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="'+classes+'"><main class="content-wrap" style="width:100%;max-width:100%;margin:0;box-sizing:border-box;padding:12px">'+body+'</main></body></html>');
 for(const css of styles(name)) await page.addStyleTag({content:css});
}
async function checkPrincipalHeaderGeometry(engine,engineName){
 const browser=await engine.launch({headless:true});
 try{
  const source=read('principal.html');
  const start=source.indexOf('<section class="controls" aria-label="Leadership report filters">');
  const navStart=source.indexOf('<nav class="principal-navigation"',start);
  const end=source.indexOf('</nav>',navStart);
  assert.ok(start>=0&&navStart>start&&end>navStart,'actual principal report controls and navigation');
  const markup=source.slice(start,end+6);
  for(const theme of ['light','dark']){
   for(const width of [320,390,768,820,1024,1194,1366,1440]){
    const touch=width<=1366;
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:touch,isMobile:touch});
    try{
     await page.setContent('<!doctype html><html data-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="shell"><main id="main">'+markup+'</main></div></body></html>');
     await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles('principal.html').map(css=>css.replace(/@import\s+[^;]+;/g,'')));
     await page.evaluate(()=>{
      document.querySelector('#reportDate').value='2026-11-24';
      const dept=document.querySelector('#departmentFilter');dept.add(new Option('Special Program in Journalism and a very long department name','long'));dept.value='long';
      document.querySelector('#principalMore').value='notifications';
      document.querySelector('#principalMyWorkspace').value='personal';
     });
     const result=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const fields=[...document.querySelectorAll('.controls input,.controls select,.principal-menu-label select')].map(e=>({id:e.id,control:rect(e),label:rect(e.closest('label'))}));
      const get=sel=>rect(document.querySelector(sel));
      const tabs=[...document.querySelectorAll('.principal-main-tabs button')].map(rect);
      return {fields,tabs,refresh:get('#refreshDashboard'),filters:get('.controls'),navigation:get('.principal-navigation'),secondary:get('.principal-navigation-secondary'),mainTabs:get('.principal-main-tabs'),overflow:document.documentElement.scrollWidth>innerWidth+1};
     });
     const detail=engineName+' '+theme+' '+width+'px '+JSON.stringify(result);
     const inside=(a,b)=>a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1&&a.y>=b.y-1&&a.y+a.height<=b.y+b.height+1;
     for(const x of result.fields){assert.ok(x.control.height>=43&&x.control.width>0,detail);assert.ok(inside(x.control,x.label),x.id+' outside label '+detail);}
     const controls=result.fields.slice(0,3).map(x=>x.control).concat(result.refresh);
     const menus=result.fields.slice(3).map(x=>x.control);
     for(const a of controls)assert.ok(inside(a,result.filters),detail);
     for(const a of menus)assert.ok(inside(a,result.secondary),detail);
     for(const a of result.tabs)assert.ok(inside(a,result.mainTabs)&&a.height>=43,detail);
     for(const list of [controls,menus,result.tabs]){
      for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)assert.ok(!overlap(list[i],list[j]),detail);
     }
     assert.ok(!overlap(result.mainTabs,result.secondary),detail);
     assert.ok(!result.overflow,detail);
    }finally{await page.close();}
   }
  }
  console.log(engineName+' actual principal report filter and navigation: 16 geometry checks passed');
 }finally{await browser.close();}
}
async function checkMemoLauncher(engine,engineName){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();
  const source=read('school-memo-banner.js');
  const fragment=source.slice(source.indexOf(' function currentList('),source.indexOf(' function setStatus('));
  for(const [name,role] of [['principal.html','PRINCIPAL'],['portal.html','TEACHER'],['student-portal.html','STUDENT'],['parent-portal.html','PARENT']]){
   for(const theme of ['light','dark']){
    for(const width of [320,390,768,1280]){
     await page.setViewportSize({width,height:844});
     await page.setContent('<!doctype html><html data-theme="'+theme+'" data-ui-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="'+(name==='portal.html'?'portal-page':'')+'"><main style="width:100%;min-width:0;max-width:100%;box-sizing:border-box;padding:12px"><aside class="attendigo-memo-banner"></aside></main></body></html>');
     await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles(name).map(css=>css.replace(/@import\s+[^;]+;/g,'')));
     await page.evaluate(({fragment,role})=>{
      const state={role,open:false,memos:[{acknowledgedAt:null}]};
      const strip=document.querySelector('aside');
      const make=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
      const render=new Function('state','strip','make','document','open','close',fragment+'\nbanner();');
      window.memoOpened=false;
      render(state,strip,make,document,()=>{window.memoOpened=true},()=>{});
     },{fragment,role});
     const geometry=await page.evaluate(()=>{
      const rect=sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      return {card:rect('.attendigo-memo-launcher'),icon:rect('.attendigo-memo-icon'),copy:rect('.attendigo-memo-copy'),arrow:rect('.attendigo-memo-launcher-arrow'),parent:rect('main'),count:document.querySelectorAll('aside button').length,display:getComputedStyle(document.querySelector('.attendigo-memo-launcher')).display};
     });
     const detail=engineName+' '+name+' '+theme+' '+width+' '+JSON.stringify(geometry);
     assert.equal(geometry.count,1,detail);
     assert.equal(geometry.display,'grid',detail);
     assert.ok(geometry.card.height>=44,detail);
     for(const a of [geometry.icon,geometry.copy,geometry.arrow]){
      const b=geometry.card;
      assert.ok(a.width>0&&a.height>0&&a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1&&a.y>=b.y-1&&a.y+a.height<=b.y+b.height+1,detail);
     }
     for(const [a,b] of [[geometry.icon,geometry.copy],[geometry.copy,geometry.arrow],[geometry.icon,geometry.arrow]])assert.ok(!overlap(a,b),detail);
     assert.ok(geometry.card.x>=geometry.parent.x-1&&geometry.card.x+geometry.card.width<=geometry.parent.x+geometry.parent.width+1,detail);
     await page.locator('.attendigo-memo-launcher').click();
     assert.equal(await page.evaluate(()=>window.memoOpened),true,detail);
    }
   }
  }
  console.log(engineName+' shared memo launcher: 32 role/theme/viewport checks passed');
 }finally{await browser.close();}
}
async function checkMemoGeometry(engine,engineName){
 const browser=await engine.launch({headless:true});
 try{
  for(const theme of ['light','dark']){
   for(const width of [320,390,768,820,1024,1194,1366]){
    const touch=width<=1194;
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:touch,isMobile:touch});
    try{
     const source=read('principal.html'),start=source.indexOf('<section id="principalMemoPublishPanel"'),end=source.indexOf('</section>',start);
     assert.ok(start>=0&&end>start,'actual publisher fixture found');
     const publisher=source.slice(start,end+10).replace('class="surface principal-memo-publish" hidden','class="surface principal-memo-publish attendigo-memo-embedded-publisher"');
     await page.setContent('<!doctype html><html data-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="shell"><main style="width:100%;min-width:0"><section id="attendigoSchoolMemoPanel" class="attendigo-memo-workspace attendigo-memo-management"><div class="attendigo-memo-toolbar"><div class="attendigo-memo-counters"><span class="attendigo-memo-counter">Published</span></div><div class="attendigo-memo-manager-actions"><button class="attendigo-memo-create">Hide publication form</button><button class="attendigo-memo-refresh">Refresh</button></div></div><div class="attendigo-memo-composer">'+publisher+'</div></section></main></div></body></html>');
     // WebKit can reject addStyleTag when a stylesheet's remote font import fails.
     // Load the same local CSS in order without waiting on third-party font requests.
     await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles('principal.html').map(css=>css.replace(/@import\s+[^;]+;/g,'')));
     assert.equal(await page.locator('#principalMemoForm').evaluate(e=>getComputedStyle(e).display),'grid');
     // Run the production field synchronizer against the actual form, rather than
     // forcing all mutually exclusive controls to appear simultaneously.
     const dashboard=read('principal-dashboard.js');
     const sync=dashboard.slice(dashboard.indexOf(' function syncPrincipalMemoOptions(){'),dashboard.indexOf(' async function publishPrincipalMemo(){'));
     await page.evaluate(code=>{
      const form=document.getElementById('principalMemoForm');
      const apply=new Function('$',code+';return syncPrincipalMemoOptions;')(id=>document.getElementById(id));
      form.elements.namedItem('category').addEventListener('change',apply);apply();
     },sync);
     const timeFields=['dismissalTime','dtrAmIn','dtrAmOut','dtrPmIn','dtrPmOut'];
     for(const [kind,expected] of Object.entries({
      GENERAL:[],SCHOOL_ADVISORY:[],SCHEDULE_NOTICE:['effectiveDate','endDate'],
      CLASS_SUSPENSION:['effectiveDate','endDate'],
      SHORTENED_PERIODS:['effectiveDate','endDate','originalMinutes','adjustedMinutes'],
      EARLY_DISMISSAL:['effectiveDate','endDate','dismissalTime'],
      TEMPORARY_DTR:['effectiveDate','endDate',...timeFields.slice(1)]
     })){
      await page.locator('select[name=category]').selectOption(kind);
      for(const name of ['effectiveDate','endDate','originalMinutes','adjustedMinutes',...timeFields]){
       const field=page.locator('input[name='+name+']');
       assert.equal(await field.isVisible(),expected.includes(name),kind+' '+name+' visibility');
       assert.equal(await field.isEnabled(),expected.includes(name),kind+' '+name+' enabled');
       if(expected.includes(name)&&['effectiveDate','endDate'].includes(name))await field.fill('2026-11-24');
       if(expected.includes(name)&&timeFields.includes(name))await field.fill('08:00');
      }
      assert.equal(await page.locator('input[name=document]').evaluate(e=>e.required),false);
     const geometry=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const form=document.getElementById('principalMemoForm');
      const fields=[...form.querySelectorAll('input:not([type=checkbox]),select,textarea')].filter(e=>e.getClientRects().length>0).map(e=>({name:e.name,control:rect(e),label:rect(e.closest('label'))}));
      return {fields,form:rect(form),panel:rect(document.getElementById('attendigoSchoolMemoPanel')),touch:matchMedia('(pointer:coarse)').matches};
     });
     for(const f of geometry.fields){
      const a=f.control,b=f.label;
      assert.ok(a.width>0&&a.height>=43,f.name+' visible touch target');
      assert.ok(a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1,f.name+' exceeds label at '+width);
      assert.ok(a.x>=geometry.form.x-1&&a.x+a.width<=geometry.form.x+geometry.form.width+1,f.name+' exceeds form at '+width);
     }
     for(let i=0;i<geometry.fields.length;i++)for(let j=i+1;j<geometry.fields.length;j++){
      const a=geometry.fields[i],b=geometry.fields[j];
      assert.ok(!overlap(a.control,b.control),a.name+' overlaps '+b.name+' at '+width);
     }
     const dates=geometry.fields.filter(f=>['effectiveDate','endDate'].includes(f.name));
     if(dates.length===2&&(geometry.touch||width<=800))assert.ok(dates[1].control.y>=dates[0].control.y+dates[0].control.height+8,'native dates must stack');
     }
     await page.locator('select[name=category]').selectOption('GENERAL');
     for(const name of ['effectiveDate','endDate',...timeFields])assert.equal(await page.locator('input[name='+name+']').inputValue(),'');
     await contained(page,'#principalMemoPublish','#principalMemoForm');
     // Measure all three rectangles in the same browser/layout snapshot.
     // Native input focus can scroll or zoom the mobile WebKit viewport between
     // separate Playwright boundingBox calls; keep the actual overlap and
     // containment assertions, and report geometry on failure.
     const toolbar=await page.evaluate(()=>{
      const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      return {create:rect('.attendigo-memo-create'),refresh:rect('.attendigo-memo-refresh'),parent:rect('.attendigo-memo-toolbar'),viewport:window.innerWidth,actionDisplay:getComputedStyle(document.querySelector('.attendigo-memo-manager-actions')).display};
     });
     const detail=engineName+' '+theme+' '+width+'px '+JSON.stringify(toolbar);
     assert.ok(toolbar.create.width>0&&toolbar.create.height>=43&&toolbar.refresh.width>0&&toolbar.refresh.height>=43,'memo toolbar visible touch targets: '+detail);
     assert.ok(!overlap(toolbar.create,toolbar.refresh),'memo toolbar buttons overlap: '+detail);
     for(const a of [toolbar.create,toolbar.refresh]){
      const b=toolbar.parent;
      assert.ok(a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1&&a.y>=b.y-1&&a.y+a.height<=b.y+b.height+1,'memo toolbar containment: '+detail);
     }
     console.log('Principal memo native control geometry: '+engineName+' '+theme+' '+width+'px passed');
    }finally{await page.close();}
   }
  }
 }finally{await browser.close();}
}

async function checkMemoRepository(engine,engineName){
 const browser=await engine.launch({headless:true});
 try{
  for(const [name,role] of [['principal.html','PRINCIPAL'],['portal.html','TEACHER'],['student-portal.html','STUDENT'],['parent-portal.html','PARENT']]){
   for(const theme of ['light','dark'])for(const width of [320,1280]){
    const page=await browser.newPage({viewport:{width,height:844},hasTouch:width<400,isMobile:width<400});
    try{
     await page.setContent('<!doctype html><html data-theme="'+theme+'" data-ui-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="width:100%;min-width:0">'+(role==='PRINCIPAL'?'<section id="principalMemoPublishPanel"><form><input name="title"></form></section>':'')+'</main></body></html>');
     await page.evaluate(sheets=>{for(const css of sheets){const node=document.createElement('style');node.textContent=css;document.head.append(node);}},styles(name).map(css=>css.replace(/@import\s+[^;]+;/g,'')));
     await page.evaluate(role=>{
      const rows=Array.from({length:18},(_,i)=>({memoId:'11111111-1111-4111-8111-'+String(i).padStart(12,'0'),title:'Notice '+i,category:'GENERAL',summary:'Fictional school memo',audience:'ALL_USERS',publishedAt:'2026-11-25T03:00:00Z',publisher:'School principal',acknowledgedAt:null}));
      window.memoFixture=rows;
      window.fetch=async path=>{
       const url=new URL(path,'https://fixture.invalid');
       if(url.pathname==='/api/auth/me')return new Response(JSON.stringify({user:{role}}),{headers:{'Content-Type':'application/json'}});
       const p=url.searchParams,limit=Number(p.get('limit')||50),offset=Number(p.get('offset')||0),q=p.get('q')||'';
       let matching=window.memoFixture.filter(r=>(!p.get('id')||p.get('id')===r.memoId)&&(!q||r.title.includes(q)));
       if(p.get('status')==='archived')matching=matching.filter(r=>r.archivedAt);
       return new Response(JSON.stringify({memoranda:matching.slice(offset,offset+limit),hasMore:matching.length>offset+limit}),{headers:{'Content-Type':'application/json'}});
      };
     },role);
     await page.addScriptTag({content:read('school-memo-banner.js')});
     await page.waitForFunction(role=>document.querySelector('.attendigo-memo-launcher-action')?.textContent===(role==='PRINCIPAL'?'Manage memoranda':'Read memoranda'),role);
     await page.locator('.attendigo-memo-launcher').click();
     const panel=page.locator('#attendigoSchoolMemoPanel');
     await page.locator('.attendigo-memo-record').waitFor();
     assert.equal(await panel.evaluate(e=>e.open),true);
     assert.equal(await page.locator('.attendigo-memo-record').count(),1);
     assert.equal(await page.locator('.attendigo-memo-search-input').first().isVisible(),false);
     assert.equal(await page.locator('.attendigo-memo-create').count(),role==='PRINCIPAL'?1:0);
     assert.equal(await page.getByRole('button',{name:'Read receipts',exact:true}).count(),role==='PRINCIPAL'?1:0);
     const bounds=await panel.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,engineName+' dialog overflow '+width);
     await page.getByRole('button',{name:/View All Memoranda/}).click();
     await page.waitForFunction(()=>document.querySelectorAll('.attendigo-memo-repository-row').length===15);
     assert.equal(await page.locator('select option[value=archived]').count(),role==='PRINCIPAL'?1:0);
     await page.getByRole('button',{name:'Next',exact:true}).click();
     await page.waitForFunction(()=>document.querySelectorAll('.attendigo-memo-repository-row').length===3);
     await page.locator('input[type=search]').fill('Notice 17');
     await page.waitForFunction(()=>document.querySelectorAll('.attendigo-memo-repository-row').length===1);
     await page.locator('.attendigo-memo-repository-row').click();
     assert.equal(await page.locator('#attendigoMemoTitle').textContent(),'Memorandum details');
     assert.equal(await page.locator('.attendigo-memo-record h3').textContent(),'Notice 17');
     await page.getByRole('button',{name:/Back/}).click();
     assert.equal(await page.locator('input[type=search]').inputValue(),'Notice 17');
     await page.getByRole('button',{name:/Back/}).click();
     await page.locator('.attendigo-memo-record').waitFor();
     assert.equal(await page.locator('.attendigo-memo-record').count(),1);
     if(role==='PRINCIPAL'){
      await page.getByRole('button',{name:/Create memorandum/}).click();
      assert.equal(await page.locator('#principalMemoPublishPanel').isVisible(),true);
      assert.equal(await page.locator('.attendigo-memo-record').count(),0);
      await page.getByRole('button',{name:/Back/}).click();
     }
     await page.getByRole('button',{name:'Close School Memoranda'}).click();
     assert.equal(await panel.isVisible(),false);
    }finally{await page.close();}
   }
  }
  console.log(engineName+' connected memo repository: 16 role/theme/viewport scenarios passed');
 }finally{await browser.close();}
}
(async()=>{
 await checkPrincipalHeaderGeometry(chromium,'Chromium');
 await checkPrincipalHeaderGeometry(webkit,'WebKit');
 await checkMemoLauncher(chromium,'Chromium');
 await checkMemoLauncher(webkit,'WebKit');
 await checkMemoGeometry(chromium,'Chromium');
 await checkMemoGeometry(webkit,'WebKit');
 await checkMemoRepository(chromium,'Chromium');
 await checkMemoRepository(webkit,'WebKit');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  // Verify the real cascade, including the formerly smaller School Admin rules.
  for(const width of [320,390,768,1280]){
   for(const role of ['SCHOOL_ADMIN','TEACHER']){
    await page.setViewportSize({width,height:844});
    await setup(page,'portal.html','<div class="portal-layout" data-attendigo-role="'+role+'"><aside class="sidebar open" id="sidebar"><nav class="side-nav"><a class="nav-item" href="#dashboard"><span class="nav-icon">▦</span><span class="nav-label">Dashboard</span></a><div class="nav-group"><button class="nav-group-toggle"><span class="nav-icon">▣</span><span class="nav-label">Student Records and Management</span><span class="nav-chevron">⌄</span></button><div class="nav-submenu"><a class="nav-item" href="#learners"><span class="nav-icon">▦</span><span class="nav-label">Requests and Approvals</span></a><a class="nav-item" hidden href="#restricted">Restricted</a></div></div></nav></aside><div class="main-area"></div></div>');
    const sizes=await page.evaluate(()=>{
     const main=document.querySelector('.nav-group-toggle .nav-label'),child=document.querySelector('.nav-submenu .nav-label'),row=main.parentElement;
     return {main:getComputedStyle(main).fontSize,child:getComputedStyle(child).fontSize,height:row.getBoundingClientRect().height,hidden:getComputedStyle(document.querySelector('.nav-item[hidden]')).display};
    });
    assert.equal(sizes.main,'17px',role+' main label at '+width);
    assert.equal(sizes.child,'16px',role+' submenu label at '+width);
    assert.ok(sizes.height>=44,role+' tap target at '+width);
    assert.equal(sizes.hidden,'none',role+' hidden nav remains hidden');
    console.log('Sidebar type and role visibility: '+role+' '+width+'px passed');
   }
  }

  for(const width of [320,375,390,430,768,1280]){
   await page.setViewportSize({width,height:900});
   await setup(page,'portal.html','<div id="adminDashboardCard" class="admin-command-center"><div class="admin-command-metrics">'+metric+metric+metric+'</div></div>'+roster+form,'data-simple-workspace-role="SCHOOL_ADMIN"');
   const label=await box(page,'.admin-command-metric > span:not(.admin-metric-icon)');
   const icon=await box(page,'.admin-metric-icon');
   assert.ok(!overlap(label,icon),'Admin metric label and icon overlap at '+width);
   await contained(page,'.admin-metric-icon','.admin-command-metric');
   await contained(page,'.section-toolbar > button','.section-toolbar');
   await contained(page,'.field-group input','.field-group');
   if(width<=700){
    assert.equal(await page.locator('.roster-mobile-summary').isVisible(),true);
    assert.equal(await page.locator('td[data-label="Student ID"]').isVisible(),false);
    await page.locator('.roster-mobile-details > summary').click();
    assert.equal(await page.locator('.roster-mobile-details dl').isVisible(),true);
    await page.locator('.roster-mobile-details > summary').click();
    await page.locator('.student-actions-dropdown > summary').click();
    await contained(page,'.student-row-actions','tr[data-student-enrollment]');
   }else{
    assert.equal(await page.locator('.roster-mobile-summary').isVisible(),false);
    assert.equal(await page.locator('td[data-label="Student ID"]').isVisible(),true);
   }
   console.log('Admin metrics, learner roster, form: '+width+'px passed');
  }
  for(const [name,classes] of [['student-portal.html','portal-page student-portal-body'],['parent-portal.html','portal-page parent-portal-body'],['principal.html',''],['gate-offline.html','offline-workspace'],['offline-sheet.html','offline-workspace'],['student-qr-offline.html','offline-workspace']]){
   await page.setViewportSize({width:390,height:844});
   await setup(page,name,form,'',classes);
   await contained(page,'.field-group input','.field-group');
   await contained(page,'.section-toolbar > button','.section-toolbar');
   console.log(name+' representative form containment passed');
  }

  // Exercise the real shared dialog component, including native top-layer nesting,
  // focus, dirty dismissal, validation, actual computed colors and narrow layouts.
  const luminance=rgb=>{
   const n=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
   return .2126*n[0]+.7152*n[1]+.0722*n[2];
  };
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  for(const theme of ['light','dark']){
   for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:width<700?540:900});
    await setup(page,'portal.html','<button id="origin">Open review</button><dialog id="underlying"><button id="nested">Nested review</button></dialog>','data-ui-theme="'+theme+'"');
    await page.addScriptTag({content:read('app-dialog.js')});
    await page.evaluate(()=>{document.querySelector('#underlying').showModal();document.querySelector('#nested').focus();window.pendingDialog=window.AppDialog.prompt('A detailed review reason is required. Original records remain unchanged.','',{title:'Review attendance correction',inputType:'textarea',required:true,confirmText:'Save review'});});
    const panel=page.locator('.app-dialog-card');
    await panel.waitFor({state:'visible'});
    assert.equal(await page.locator('dialog.app-dialog-overlay').evaluate(d=>d.matches(':modal')),true);
    await contained(page,'.app-dialog-input','.app-dialog-card');
    await contained(page,'.app-dialog-actions','.app-dialog-card');
    const colors=await page.evaluate(()=>{
     const p=document.querySelector('.app-dialog-card'),m=document.querySelector('.app-dialog-message'),b=document.querySelector('.app-dialog-button-primary');
     return {fg:getComputedStyle(m).color,bg:getComputedStyle(p).backgroundColor,button:getComputedStyle(b).color,buttonBg:getComputedStyle(b).backgroundColor,font:getComputedStyle(m).fontSize};
    });
    assert.ok(contrast(colors.fg,colors.bg)>=4.5,theme+' message contrast');
    assert.ok(contrast(colors.button,colors.buttonBg)>=4.5,theme+' primary button contrast');
    assert.equal(colors.font,'16px');
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    assert.ok(await page.locator('.app-dialog-error').isVisible());
    await page.locator('.app-dialog-input').fill('Verified sample evidence');
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'Keep editing',exact:true}).isVisible());
    await page.getByRole('button',{name:'Keep editing',exact:true}).click();
    assert.equal(await page.locator('.app-dialog-input').inputValue(),'Verified sample evidence');
    await page.getByRole('button',{name:'Save review',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.pendingDialog),'Verified sample evidence');
    assert.equal(await page.locator('#underlying').evaluate(d=>d.open),true);
    await page.evaluate(()=>{document.querySelector('#underlying').close();window.pendingDialog=window.AppDialog.confirm('Remove this item?',{variant:'danger',confirmText:'Remove item'});});
    await page.locator('.app-dialog-card').waitFor();
    await page.waitForFunction(()=>document.activeElement?.textContent==='Cancel');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.pendingDialog),false);
    console.log('Dialog behavior and contrast: '+theme+' '+width+'px passed');
   }
  }

  // Exercise the actual campus form and script with synthetic GPS and registry responses.
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});
   const html=read('principal.html'), start=html.indexOf('<details class="surface" id="trustedCampusSettings">'), end=html.indexOf('   <div class="section-heading">',start);
   assert.ok(start>=0&&end>start,'campus panel fixture found');
   await setup(page,'principal.html',html.slice(start,end),'','');
   await page.addStyleTag({content:read('campus-location-ui.css')});
   await page.evaluate(()=>{
    window.fetch=async()=>({ok:true,json:async()=>({campuses:[],departments:[]})});
    window.attendigoPreciseLocation={collectPreciseLocation:async()=>({latitude:7.1,longitude:125.6,accuracyMeters:12})};
   });
   await page.addScriptTag({content:read('principal-trusted-campus.js')});
   await page.locator('#trustedCampusSettings > summary').click();
   await page.getByText('Register a campus',{exact:true}).click();
   await page.locator('#trustedCampusGps').click();
   assert.equal(await page.locator('#trustedCampusForm input[name=latitude]').inputValue(),'7.1');
   assert.equal(await page.locator('#trustedCampusForm input[name=longitude]').inputValue(),'125.6');
   assert.equal(await page.locator('#trustedCampusForm input[name=attested]').isChecked(),false);
   await page.locator('#trustedCampusForm input[name=attested]').check();
   await page.locator('#trustedCampusForm input[name=radiusMeters]').fill('500');
   assert.equal(await page.locator('#trustedCampusForm input[name=attested]').isChecked(),false);
   assert.equal(await page.locator('#trustedCampusRadiusSlider').inputValue(),'500');
   assert.ok((await page.locator('#trustedCampusRadiusText').textContent()).includes('500 m radius'));
   assert.ok(await page.locator('#trustedCampusMapLink').isVisible());
   const checkbox=await box(page,'#trustedCampusForm input[name=attested]');
   assert.ok(checkbox.width>=20&&checkbox.width<=26,'checkbox must remain compact');
   await contained(page,'#trustedCampusGps','#trustedCampusForm');
   await contained(page,'#trustedCampusForm input[name=radiusMeters]','#trustedCampusForm');
   await contained(page,'.campus-preview','#trustedCampusForm');
   console.log('Campus GPS, radius, attestation and mobile geometry: '+width+'px passed');
  }

  // Actual new School Identity settings and Form 6 layout, with fictional data.
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});
   const portal=read('portal.html');
   const start=portal.indexOf('<div class="surface-card section-card document-branding-card"');
   const end=portal.indexOf('</section>',start);
   assert.ok(start>=0&&end>start);
   await setup(page,'portal.html',portal.slice(start,end),'data-simple-workspace-role="SCHOOL_ADMIN"');
   await page.evaluate(()=>{
    document.getElementById('documentBrandingFields').disabled=false;
    document.getElementById('documentPreviewSchool').textContent='Fictional School With a Long Registered Name';
    document.getElementById('documentPreviewAddress').textContent='Fictional long school address for wrapping and layout checks';
   });
   await contained(page,'.doc-brand-grid input','.document-branding-card');
   await contained(page,'.doc-brand-actions button','.document-branding-card');
   await contained(page,'.doc-brand-preview','.document-branding-card');
   const input=await box(page,'.doc-brand-grid input');
   assert.ok(input.height>=44,'document settings touch target');
   await page.setContent(read('leave-form6.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
   await page.evaluate(()=>{
    document.getElementById('school').textContent='Fictional School With a Long Registered Name';
    document.getElementById('formDivision').textContent='Fictional Division Office';
    document.getElementById('name').textContent='Fictional Applicant Name';
    document.getElementById('details').textContent='Fictional leave detail';
    for(let i=0;i<14;i++){const node=document.createElement('span');node.className='checkline';node.textContent='☐ Example leave type';document.getElementById('types').append(node);}
   });
   await contained(page,'.document-head','.sheet');
   await contained(page,'.approval','.sheet');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Form 6 screen overflows at '+width);
   await page.emulateMedia({media:'print'});
   assert.equal(await page.locator('.print-tools').isVisible(),false);
   const printCols=await page.locator('.grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
   assert.equal(printCols,12,'print grid must not use the mobile stacked layout');
   await page.emulateMedia({media:'screen'});
   console.log('Document identity and Form 6 screen/print geometry: '+width+'px passed');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
