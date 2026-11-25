'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const origin='https://attendigo-staging.onrender.com';
const cache=fs.readFileSync('public/sw.js','utf8').match(/const CACHE = "([^"]+)"/)[1];
const version=fs.readFileSync('public/portal-login.html','utf8').match(/href="(\/attendigo-experience\.css\?v=\d+)"/)[1];
async function waitCandidate(){
 for(let i=0;i<50;i++){
  try{
   const res=await fetch(origin+'/sw.js?release='+encodeURIComponent(cache),{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(res.ok&&(await res.text()).includes('const CACHE = "'+cache+'"'))return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,6000));
 }
 throw new Error('Exact candidate service worker not available on staging');
}
(async()=>{
 await waitCandidate();
 const css=await fetch(origin+version,{cache:'no-store',signal:AbortSignal.timeout(20000)});
 assert.equal(css.status,200);
 assert.ok((await css.text()).includes('--ax-card-radius'));
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:width===1440?900:720}});
    try{
     const page=await context.newPage();
     await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:90000});
     await page.waitForURL(url=>url.origin===origin&&url.pathname==='/portal-login.html',{timeout:30000});
     await page.locator('#loginForm').waitFor({state:'visible'});
     assert.equal(await page.locator('link[href="'+version+'"]').count(),1);
     for(const selector of ['#schoolCode','#username','#password','#signInButton','#studentMode','#schoolMode'])assert.ok(await page.locator(selector).isVisible(),selector+' '+width);
     await page.locator('#studentMode').click();
     assert.equal(await page.locator('#studentMode').getAttribute('aria-pressed'),'true');
     await page.locator('#schoolMode').click();
     assert.equal(await page.locator('#schoolMode').getAttribute('aria-pressed'),'true');
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'horizontal overflow '+width);
     assert.equal((await context.request.get(origin+'/api/auth/me')).status(),401);
     console.log(engine.name()+' staging public login and session boundary '+width+'px passed');
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
