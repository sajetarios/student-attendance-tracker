const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/attendigo-sidebar-adaptive.js','utf8');
const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const rgb=s=>s.match(/\d+/g).map(Number);
test('custom sidebar colors retain accessible text, selected, hover and boundary contrast after theme changes',()=>{
 const logo={}, extraLogo={remove(){this.removed=true}},
       brand={querySelector:()=>logo,querySelectorAll:()=>[logo,extraLogo]};
 const props={},root={className:'',getAttribute:()=>mode};let mode='light',bg='rgb(0,0,0)',callback;
 const sidebar={querySelector:()=>brand,dataset:{},style:{setProperty:(k,v)=>props[k]=v}};
 vm.runInNewContext(source,{document:{getElementById:()=>sidebar,documentElement:root,addEventListener(){}},window:{addEventListener(){}},MutationObserver:class{constructor(fn){callback=fn}observe(){}},requestAnimationFrame:fn=>fn(),getComputedStyle:()=>({backgroundColor:bg})});
 for(mode of ['light','dark'])for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17){
  bg=`rgb(${r},${g},${b})`;callback();const color=[r,g,b];
  for(const key of ['--side-ink','--side-muted'])assert.ok(ratio(color,rgb(props[key]))>=4.5,`${bg} ${key}`);
  assert.ok(ratio(color,rgb(props['--side-border']))>=3);
  for(const state of ['selected','hover'])assert.ok(ratio(rgb(props[`--side-${state}`]),rgb(props[`--side-${state}-ink`]))>=4.5);
 }
 assert.equal(logo.src,'/assets/attendigo-sidebar-logo.png?v=2');
 assert.equal(logo.alt,'Attendigo');
 assert.equal(extraLogo.removed,true);
});
