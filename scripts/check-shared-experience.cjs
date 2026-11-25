'use strict';
// Synthetic representative layouts; no credentials, API calls or personal data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const css=fs.readFileSync(path.join(__dirname,'..','public','attendigo-experience.css'),'utf8');
const roles=['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATEKEEPER','STUDENT','PARENT','PRINCIPAL'];
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage();
   for(const role of roles)for(const theme of ['light','dark'])for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:720});
    await page.emulateMedia({reducedMotion:'reduce',media:'screen'});
    const principal=role==='PRINCIPAL';
    const heading=principal?'metric-label':'student-profile-item';
    const card=principal?'metric-card':'student-card';
    await page.setContent('<!doctype html><html data-theme="'+theme+'"><body class="'+(principal?'':'portal-page')+'"><main id="main"><div class="'+card+'" style="width:100%;box-sizing:border-box"><div class="'+heading+'">Examplelonguninterruptedlabelthatmustwrapwithoutoverflow</div><button class="primary-button">Open details</button></div></main></body></html>');
    await page.addStyleTag({content:css});
    const result=await page.evaluate(({card,heading})=>{
      const el=document.querySelector('.'+card),label=document.querySelector('.'+heading),button=document.querySelector('button');
      const styles=getComputedStyle(button);
      return {radius:getComputedStyle(el).borderTopLeftRadius,overflow:document.documentElement.scrollWidth>innerWidth,transition:styles.transitionDuration,focus:getComputedStyle(document.documentElement).getPropertyValue('--ax-focus').trim(),label:getComputedStyle(label).overflowWrap};
    },{card,heading});
    assert.equal(result.radius,'14px',role);
    assert.equal(result.transition,'0s',role);
    assert.equal(result.focus,theme==='dark'?'#a6cfff':'#245f9d',role);
    if(principal){assert.equal(result.label,'anywhere');assert.equal(result.overflow,false);}
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('button').evaluate(el=>getComputedStyle(el).outlineWidth),'2px');
    await page.emulateMedia({media:'print'});
    assert.notEqual(await page.locator('.'+card).evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'14px');
   }
   console.log(engine.name()+' shared UI token, focus, theme, reduced-motion and print isolation matrix passed');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
