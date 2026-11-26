'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const html=read('portal.html');
function extract(start,end){const i=html.indexOf(start),j=html.indexOf(end,i);assert.ok(i>=0&&j>i,start);return html.slice(i,j+end.length);}
const intro=extract('<header class="ax-workspace-intro"','</header>'),summary=extract('<section class="surface-card learner-summary-card"','</section>'),nav=extract('<aside class="sidebar"','</aside>');
const styles=[...html.split('</head>')[0].matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>(m[1]?read(m[1]):m[2]).replace(/@import\s+[^;]+;/g,''));
(async()=>{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [320,390,768,1440]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width<800,hasTouch:width<800});try{
 await page.setContent('<!doctype html><html class="attendigo-teacher-v3 attendigo-simple-workspace" data-simple-workspace-role="TEACHER"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="portal-page"><div class="portal-layout" data-attendigo-role="TEACHER">'+nav+'<main class="main-area"><div class="content-wrap"><div id="dashboardView">'+intro+'<section id="dashboardScanCta">Scanner</section>'+summary+'</div></div></main></div></body></html>');
 await page.evaluate(s=>{for(const css of s){const e=document.createElement('style');e.textContent=css;document.head.append(e);}},styles);
 await page.evaluate(()=>{window.attendigoStaffIdentity=Promise.resolve({role:'TEACHER'});document.querySelector('#sidebar').classList.add('open');document.getElementById('learnerTotal').textContent='128';document.getElementById('learnerPresent').textContent='64';});
 await page.addScriptTag({content:read('attendigo-adaptive-palette.js')});
 await page.addScriptTag({content:read('attendigo-role-workspaces.js')});
 await page.waitForSelector('#dashboardView[data-ax-teaching-day]');
 const result=await page.evaluate(()=>{const cards=[...document.querySelectorAll('#learnerSummaryCard .learner-metric')],nav=document.getElementById('dashboardNav'),icon=nav.querySelector('.nav-icon');return {colors:cards.map(c=>getComputedStyle(c).backgroundImage),ink:getComputedStyle(nav).color,icon:getComputedStyle(icon).color,pseudo:getComputedStyle(nav,'::before').content,overflow:cards.some(c=>c.scrollWidth>c.clientWidth+1),order:getComputedStyle(document.getElementById('learnerSummaryCard')).order,progress:document.querySelector('.ax-progress-ring strong').textContent};});
 assert.equal(new Set(result.colors).size,4,JSON.stringify(result));assert.ok(result.colors.every(c=>c.includes('gradient')));assert.equal(result.ink,result.icon);if(width<=860)assert.equal(result.pseudo,'none');assert.equal(result.order,'-9');assert.equal(result.progress,'50%');assert.equal(result.overflow,false,JSON.stringify(result));
 const changed=await page.evaluate(()=>{const card=document.querySelector('.learner-metric'),before=getComputedStyle(card).backgroundImage;window.AttendigoPalette.apply('#a32a70');return {before,after:getComputedStyle(card).backgroundImage,sidebar:getComputedStyle(document.getElementById('sidebar')).backgroundColor};});assert.notEqual(changed.before,changed.after);assert.equal(changed.sidebar,'rgb(163, 42, 112)');
 }finally{await page.close();}
 }}finally{await browser.close();}console.log(engine.name()+' teaching dashboard colors, menu contrast, responsive cards and live data bindings passed');}})().catch(e=>{console.error(e);process.exitCode=1;});
