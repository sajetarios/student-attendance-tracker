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
     const publisher=source.slice(start,end+10).replace('class="surface principal-memo-publish" hidden','class="surface principal-memo-publish attendigo-memo-embedded-publisher"').replace('id="principalMemoDtrFields" hidden','id="principalMemoDtrFields"');
     await page.setContent('<!doctype html><html data-theme="'+theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="shell"><main style="width:100%;min-width:0"><section id="attendigoSchoolMemoPanel" class="attendigo-memo-workspace attendigo-memo-management"><div class="attendigo-memo-toolbar"><div class="attendigo-memo-counters"><span class="attendigo-memo-counter">Published</span></div><div class="attendigo-memo-manager-actions"><button class="attendigo-memo-create">Hide publication form</button><button class="attendigo-memo-refresh">Refresh</button></div></div><div class="attendigo-memo-composer">'+publisher+'</div></section></main></div></body></html>');
     for(const css of styles('principal.html'))await page.addStyleTag({content:css});
     const geometry=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const form=document.getElementById('principalMemoForm');
      const fields=[...form.querySelectorAll('input:not([type=checkbox]),select,textarea')].map(e=>({name:e.name,control:rect(e),label:rect(e.closest('label'))}));
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
     if(geometry.touch||width<=800)assert.ok(dates[1].control.y>=dates[0].control.y+dates[0].control.height+8,'native dates must stack');
     await contained(page,'#principalMemoPublish','#principalMemoForm');
     const create=await box(page,'.attendigo-memo-create'),refresh=await box(page,'.attendigo-memo-refresh');
     assert.ok(!overlap(create,refresh),'memo toolbar buttons overlap');
     await contained(page,'.attendigo-memo-create','.attendigo-memo-toolbar');
     await contained(page,'.attendigo-memo-refresh','.attendigo-memo-toolbar');
     console.log('Principal memo native control geometry: '+engineName+' '+theme+' '+width+'px passed');
    }finally{await page.close();}
   }
  }
 }finally{await browser.close();}
}
(async()=>{
 await checkMemoGeometry(chromium,'Chromium');
 await checkMemoGeometry(webkit,'WebKit');
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
