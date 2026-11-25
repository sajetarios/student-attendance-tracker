'use strict';
// Exercise the real staff view markup and actual ordered stylesheet cascade.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const html=read('portal.html');
const start=html.indexOf('<section id="myGateAttendanceView"');
const end=html.indexOf('</section>',start);
assert.ok(start>=0&&end>start);
const section=html.slice(start,end+10).replace('class="view-panel" hidden','class="view-panel"');
const styles=[...html.split('</head>')[0].matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]?read(m[1]):m[2]);
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   for(const width of [320,375,390,414,430,480,600,768,900]){
    const page=await browser.newPage({viewport:{width,height:850},isMobile:true,hasTouch:true});
    try{
     await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body class="portal-page"><main class="content-wrap" style="width:100%;max-width:100%;box-sizing:border-box;margin:0;padding:12px">'+section+'</main></body></html>');
     for(const css of styles)await page.addStyleTag({content:css});
     await page.locator('#myGateFrom').fill('2026-11-20');
     await page.locator('#myGateTo').fill('2026-11-26');
     const result=await page.evaluate(()=>{
      const rect=id=>{const b=document.querySelector(id).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
      return {from:rect('#myGateFrom'),to:rect('#myGateTo'),apply:rect('#myGateApply'),filter:rect('.my-gate-filters'),card:rect('.my-gate-attendance'),heading:rect('#myGateHeading'),refresh:rect('#myGateRefresh'),font:getComputedStyle(document.querySelector('#myGateHeading')).fontSize};
     });
     for(const name of ['from','to','apply']){
      const b=result[name];assert.ok(b.width>0&&b.height>=43,engine.name()+' '+width+' '+name+' touch target');
      assert.ok(b.left>=result.filter.left-1&&b.right<=result.filter.right+1,engine.name()+' '+width+' '+name+' overflows');
     }
     assert.ok(result.from.bottom<=result.to.top+1,engine.name()+' '+width+' dates overlap');
     assert.ok(result.to.bottom<=result.apply.top+1,engine.name()+' '+width+' date/apply overlap');
     assert.ok(result.heading.bottom<=result.refresh.top+1,engine.name()+' '+width+' heading/refresh overlap');
     assert.equal(result.font,'20px');
    }finally{await page.close();}
   }
   console.log(engine.name()+' actual staff attendance geometry passed at 9 widths');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
