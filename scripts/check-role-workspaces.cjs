'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const staff=read('portal.html'),js=read('attendigo-role-workspaces.js');
function styles(source){return [...source.split('</head>')[0].matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]?read(m[1]):m[2]);}
function slice(source,start,end){const i=source.indexOf(start),j=source.indexOf(end,i);assert.ok(i>=0&&j>i,start);return source.slice(i,j+end.length);}
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
    for(const css of styles(staff))await page.addStyleTag({content:css});
    await page.evaluate(role=>{document.querySelector('#sidebar').classList.add('open');document.querySelector('.portal-layout').removeAttribute('data-attendigo-role');window.attendigoStaffIdentity=Promise.resolve({role});},role);
    const hiddenBefore=await page.locator('#sidebar [hidden]').count();
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
     for(const css of styles(source))await page.addStyleTag({content:css});
     const b=await page.locator(selector).evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth,width:e.getBoundingClientRect().width}));
     assert.ok(b.width>0&&b.scroll<=b.client+1,name+' header overflow '+width);
    }finally{await page.close();}
   }
  }
  console.log(engine.name()+' seven-role real navigation/header markup geometry and role-preserving presentation checks passed');
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
