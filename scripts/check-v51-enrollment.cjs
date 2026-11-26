'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const staff=read('portal.html'),js=read('attendigo-role-workspaces.js');
const styles=[...staff.split('</head>')[0].matchAll(/<link\b[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>(m[1]?read(m[1]):m[2]).replace(/@import\s+[^;]+;/g,''));
const start=staff.indexOf('<div class="table-scroll ax-enrollment-table">'),end=staff.indexOf('</table></div>',start)+14;
assert.ok(start>=0&&end>start);
const table=staff.slice(start,end);
assert.ok(read('academic-admin.js').includes("td.dataset.axField=['id','name','grade','section','status'][i]"));
assert.ok(read('special-program-ui.js').includes("cell.dataset.axField='select'"));
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{for(const width of [320,375,390,430,768]){
 const page=await browser.newPage({viewport:{width,height:800},isMobile:true,hasTouch:true});
 try{
 await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="portal-page"><main id="schoolWorkspace" style="width:100%;padding:10px;box-sizing:border-box">'+table+'</main></body></html>');
 await page.evaluate(s=>{for(const css of s){const el=document.createElement('style');el.textContent=css;document.head.append(el);}},styles);
 await page.locator('#academicEnrollmentRows').evaluate(host=>{host.innerHTML='<tr><td data-ax-field="select"><input type="checkbox" aria-label="Select fictional learner"></td><td data-ax-field="id">26-00034</td><td data-ax-field="name">Fictional Long Learner Surname and Given Name</td><td data-ax-field="grade">Grade 8</td><td data-ax-field="section">Long special program section</td><td data-ax-field="status">Active</td><td data-ax-field="program">SPJ</td><td data-ax-field="action"><select aria-label="Special program"><option>Special Program in Journalism</option></select><button type="button">Set primary</button></td></tr>';});
 const g=await page.evaluate(()=>{const wrap=document.querySelector('.ax-enrollment-table'),row=wrap.querySelector('tbody tr'),box=e=>e.getBoundingClientRect(),r=box(row);return {width:r.width,wrap:wrap.clientWidth,scroll:wrap.scrollWidth,inside:[...row.cells,...row.querySelectorAll('button,select')].every(e=>{const b=box(e);return b.left>=r.left-1&&b.right<=r.right+1&&b.width>0;})};});
 assert.ok(g.inside&&g.scroll<=g.wrap+1,engine.name()+' '+width+' '+JSON.stringify(g));
 await page.getByRole('checkbox').check();assert.equal(await page.getByRole('checkbox').isChecked(),true);
 assert.ok(await page.getByRole('button',{name:'Set primary'}).isVisible());
 }finally{await page.close();}
 }}finally{await browser.close();}
 console.log(engine.name()+' enrollment records mobile layout passed');
}})().catch(e=>{console.error(e);process.exitCode=1;});
