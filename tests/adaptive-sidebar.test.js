'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/attendigo-sidebar-adaptive.js','utf8');
const css=fs.readFileSync('public/attendigo-sidebar-adaptive.css','utf8');
const refresh=fs.readFileSync('public/attendigo-brand-refresh.css','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const worker=fs.readFileSync('public/sw.js','utf8');
const light=fs.readFileSync('public/assets/attendigo-wordmark-on-light.svg','utf8');
const dark=fs.readFileSync('public/assets/attendigo-wordmark-on-dark.svg','utf8');
const symbol=fs.readFileSync('public/assets/attendigo-symbol-transparent.svg','utf8');
const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const rgb=s=>s.match(/\d+/g).map(Number);
function harness(){
  const logo={src:'/assets/attendigo-wordmark-on-dark.svg?v=2',getAttribute(name){return name==='src'?this.src:null}};
  const extraLogo={remove(){this.removed=true}};
  const brand={querySelector:()=>logo,querySelectorAll:()=>[logo,extraLogo]};
  const props={},sidebar={querySelector:()=>brand,dataset:{},style:{setProperty:(k,v)=>{props[k]=v}}};
  const root={className:'',getAttribute:()=>mode};
  const sync={click(){this.clicked=true}};
  const document={documentElement:root,getElementById:id=>id==='sidebar'?sidebar:id==='connectionStatus'?sync:id==='sidebarSyncStatus'?{addEventListener:(type,fn)=>{syncAction=fn}}:null,addEventListener(){}};
  let mode='light',bg='rgb(0,0,0)',gradient='none',callback,syncAction;
  vm.runInNewContext(source,{document,window:{addEventListener(){}},
    MutationObserver:class{constructor(fn){callback=fn}observe(){}},
    requestAnimationFrame:fn=>fn(),
    getComputedStyle:()=>({backgroundColor:bg,backgroundImage:gradient})
  });
  return {logo,extraLogo,sidebar,props,sync,
    setBackground(value,gradientValue='none'){bg=value;gradient=gradientValue;callback()},
    setTheme(value){mode=value;callback()},
    syncClick(){syncAction?.()}
  };
}
test('school-selected sidebar colors preserve accessible navigation and the original transparent symbol',()=>{
 const h=harness();
 for(const mode of ['light','dark']){
  h.setTheme(mode);
  for(let r=0;r<=255;r+=51)for(let g=0;g<=255;g+=51)for(let b=0;b<=255;b+=51){
    h.setBackground('rgb('+r+','+g+','+b+')');
    const bg=[r,g,b],vars=h.props;
    assert.ok(ratio(bg,rgb(vars['--side-ink']))>=4.5-1e-3);
    assert.ok(ratio(bg,rgb(vars['--side-muted']))>=4.5-.04);
    assert.ok(ratio(bg,rgb(vars['--side-border']))>=3-.03);
    for(const state of ['selected','hover'])assert.ok(ratio(rgb(vars['--side-'+state]),rgb(vars['--side-'+state+'-ink']))>=4.5-1e-3);
    const expected='/assets/attendigo-symbol-transparent.svg?v=2';
    assert.equal(h.logo.src,expected);
  }
 }
 assert.equal(h.logo.alt,'Attendigo — Every learner counts.');
 assert.equal(h.extraLogo.removed,true);
});
test('contrasting gradient colors trigger a neutral brand backing without recoloring school emblem',()=>{
 const h=harness();
 h.setBackground('rgb(15,34,56)','linear-gradient(120deg, rgb(15,34,56), rgb(255,248,238))');
 assert.equal(h.sidebar.dataset.logoBacked,'true');
 assert.match(css,/#sidebarSchoolMark img/);
 assert.match(css,/filter:none!important/);
 assert.match(css,/object-fit:contain!important/);
 assert.ok(!source.includes('sidebarSchoolMark'));
});
test('original approved Attendigo artwork is used in both transparent light/dark variants',()=>{
 for(const asset of [light,dark,symbol]){
  assert.match(asset,/<svg/);
  assert.match(asset,/data:image\/png;base64,/);
  assert.match(asset,/feColorMatrix/);
  assert.match(asset,/transparent|transparency|key-white|key-black/);
 }
 const embedded=asset=>asset.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1];
 assert.equal(embedded(light),embedded(dark));
 assert.equal(embedded(light),embedded(symbol));
 assert.match(dark,/<clipPath id="symbol">/);
 assert.match(dark,/<clipPath id="wordmark">/);
});
test('sidebar is card-free, compact, and keeps other portals branded with their existing surfaces',()=>{
 assert.match(html,/id="sidebarSchoolMark"/);
 assert.match(html,/id="sidebarSchoolName"/);
 assert.match(html,/attendigo-symbol-transparent\.svg\?v=2/);
 assert.match(css,/attendigo-brand \{/);
 assert.match(css,/background:transparent!important/);
 assert.match(css,/side-primary-height:44px/);
 assert.match(css,/side-child-height:40px/);
 assert.match(css,/-webkit-line-clamp:3/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(refresh,/:not\(#sidebar > \.attendigo-brand\)/);
 assert.match(html,/id="peopleNavChildren"/);
 assert.match(html,/aria-controls="academicNavChildren"/);
});
test('sidebar sync shortcut is removed, while topbar Sync Center and offline sync remain',()=>{
 assert.doesNotMatch(html,/id="sidebarSyncStatus"|Attendance sync status/);
 assert.doesNotMatch(source,/sidebarSyncStatus/);
 assert.match(html,/id="connectionStatus"[^>]*aria-controls="attendanceSyncDialog"/);
 assert.match(html,/src="\/attendance-sync-center\.js\?v=3"/);
 assert.match(html,/src="\/offline-attendance\.js\?v=5"/);
 assert.doesNotMatch(css,/#sidebar\.sidebar \.sidebar-status/);
 assert.ok(!html.includes('Connected to local server'));
});
test('the service worker caches the deployed variants and correct versioned sidebar assets',()=>{
 const assets=['/attendigo-sidebar-adaptive.css?v=14','/attendigo-sidebar-adaptive.js?v=8',
 '/attendigo-brand-refresh.css?v=3','/assets/attendigo-wordmark-on-light.svg?v=2',
 '/assets/attendigo-wordmark-on-dark.svg?v=2','/assets/attendigo-symbol-transparent.svg?v=2'];
 for(const asset of assets)assert.ok(worker.includes(JSON.stringify(asset)),asset);
 for(const asset of [assets[0],assets[1],assets[2],assets[5]])assert.ok(html.includes(asset),asset);
 assert.ok(Number(worker.match(/const CACHE = "attendigo-v(\d+)-/)[1]) >= 167, 'PWA cache version must include removal of sidebar sync shortcut');
});
