'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {suggest}=require('../public/locator-table-suggest');
function image(occupied=false){const width=800,height=1100,data=new Uint8ClampedArray(width*height*4).fill(255);const pixel=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;};const ys=[200,222,244,266,315,337,359,391];for(const y of ys)for(let x=70;x<=730;x++)pixel(x,y);for(const x of [70,270,730])for(let y=200;y<=391;y++)pixel(x,y);if(occupied)for(let x=300;x<600;x++)for(let y=203;y<218;y++)pixel(x,y);return {width,height,data};}
test('suggests six blank cells for confirmed common row profile',()=>{const m=suggest(image());assert.ok(m);assert.deepEqual(Object.keys(m),['name','position','station','purpose','event','destination']);assert.ok(m.name[0]>270/800);assert.ok(m.event[1]>337/1100);});
test('does not propose occupied cells or unrecognized blank pages',()=>{assert.equal(suggest(image(true)),null);const i=image();i.data.fill(255);assert.equal(suggest(i),null);});
test('platform navigation exposes independent Document Templates page',()=>{const fs=require('node:fs');assert.match(fs.readFileSync('public/portal.js','utf8'),/platformDocuments: \['documents'/);assert.match(fs.readFileSync('public/portal.html','utf8'),/data-platform-tab="documents" hidden>\s*<section[^>]+id="platformLocatorRequests"/);});
