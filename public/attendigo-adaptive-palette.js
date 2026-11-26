'use strict';
/* Deterministic school-harmonized palette; no attendance/status logic. */
(function(){
 const DEFAULT='#4f2dcc', valid=s=>typeof s==='string'&&/^#[0-9a-f]{6}$/i.test(s);
 const rgb=s=>s.slice(1).match(/../g).map(x=>parseInt(x,16)/255);
 const hex=a=>'#'+a.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
 function hsl(s){const [r,g,b]=rgb(s),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;let h=0;if(d){h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;}return [(h*60+360)%360,d?d/(1-Math.abs(2*l-1)):0,l];}
 function color(h,s,l){h=((h%360)+360)%360;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;let a=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return hex(a.map(v=>v+m));}
 function lum(s){return rgb(s).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);}
 function contrast(a,b){let x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
 function ink(bg){return contrast(bg,'#ffffff')>=contrast(bg,'#101827')&&contrast(bg,'#ffffff')>=4.5?'#ffffff':contrast(bg,'#101827')>=4.5?'#101827':'#000000';}
 // Prefer the existing icon tone when it is legible, otherwise choose the
 // highest-contrast neutral. Mixed backgrounds receive a solid neutral backing.
 function iconTone(backgrounds,preferred){
  const samples=backgrounds.filter(valid);if(!samples.length)return null;
  const score=c=>Math.min(...samples.map(b=>contrast(b,c)));
  const neutral=score('#ffffff')>=score('#000000')?'#ffffff':'#000000';
  if(valid(preferred)&&score(preferred)>=4.5)return {ink:preferred,backing:null};
  if(score(neutral)>=4.5)return {ink:neutral,backing:null};
  return {ink:neutral,backing:neutral==='#ffffff'?'#101827':'#ffffff'};
 }
 function build(input){
  const nav=valid(input)?input.toLowerCase():DEFAULT;
  const [h,s]=hsl(nav),hue=s<.12? hsl(DEFAULT)[0]:h;
  // Exact Electric Violet reference swatches for the default. Rotate the
  // decorative swatches around the school's hue; retain a distinct green
  // success accent and leave warning/danger colors untouched.
  const shift=hue-hsl(DEFAULT)[0],base=['#6c4dff','#2ccb8f','#4da3ff','#8bcf3f'];
  const cards=base.map((v,i)=>{if(i===1||Math.abs(shift)<.1)return v;let [a,b,c]=hsl(v);return color(a+shift,b,c);});
  const primary=color(hue,.72,.40);
  return {nav,navInk:ink(nav),primary,primaryInk:ink(primary),cards,cardInk:cards.map(ink),tint:color(hue,.52,.96),darkTint:color(hue,.25,.14)};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={build,contrast,ink,iconTone};return;}
 const root=document.documentElement;let current=null;
 function apply(input){
  const p=build(input);if(current===p.nav)return;current=p.nav;
  const vars={'--ap-nav':p.nav,'--ap-nav-ink':p.navInk,'--ap-primary':p.primary,'--ap-primary-ink':p.primaryInk,'--ap-tint':p.tint,'--ap-dark-tint':p.darkTint};
  p.cards.forEach((c,i)=>{vars['--ap-card-'+(i+1)]=c;vars['--ap-ink-'+(i+1)]=p.cardInk[i];});
  for(const [name,value] of Object.entries(vars))root.style.setProperty(name,value);
  root.dataset.adaptivePalette='true';
 }
 window.AttendigoPalette={apply,build};apply();
 // Scope to navigation and control/metric glyphs, never images, logos,
 // QR canvases, charts, official emblems or semantic status icons.
 const iconSelector='.nav-icon,.principal-nav-icon,.principal-action-icon,.teacher-v3-metric-icon,.metric-icon,.student-summary-icon,.quick-action-icon,.admin-action-icon,.admin-shortcut-icon,.ui-icon,.ax-signature-dock svg,.ax-weather-refresh svg';
 const excluded='.attendigo-brand,.sidebar-brand,.brand-mark,.school-emblem,.school-logo,.brand,.status-icon,[data-status],.ax-weather-heat,.ax-weather-main,.status-badge,[role="img"],[data-preserve-icon-color]';
 const parsed=s=>{
  if(valid(s))return {rgb:rgb(s),a:1};
  const match=String(s||'').match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if(!match)return null;return {rgb:match.slice(1,4).map(x=>Number(x)/255),a:match[4]===undefined?1:Number(match[4])};
 };
 const blend=(front,back)=>front.rgb.map((x,i)=>x*front.a+back[i]*(1-front.a));
 function surfaces(node){
  const layers=[];let base=[1,1,1];
  for(let n=node;n&&n.nodeType===1;n=n.parentElement){
   const s=getComputedStyle(n),bg=parsed(s.backgroundColor);
   const stops=[...String(s.backgroundImage||'').matchAll(/rgba?\([^)]*\)|#[0-9a-f]{6}\b/gi)].map(m=>parsed(m[0])).filter(Boolean);
   if(bg&&bg.a>0||stops.length)layers.push({bg,stops});
   if(bg?.a>=.999&&!stops.length)break;
   if(stops.length&&stops.every(x=>x.a>=.999))break;
  }
  let samples=[base];
  for(const {bg,stops} of layers.reverse()){
   if(bg&&bg.a>0)samples=samples.map(b=>blend(bg,b));
   if(stops.length)samples=stops.flatMap(s=>samples.map(b=>blend(s,b))).slice(0,24);
  }
  return [...new Set(samples.map(hex))];
 }
 const managed=new WeakMap();let queued=false,full=false;const pending=new Set();
 function set(n,prop,value){if(n.style.getPropertyValue(prop)!==value||n.style.getPropertyPriority(prop)!=='important')n.style.setProperty(prop,value,'important');}
 function restore(n){const old=managed.get(n);if(!old)return;for(const [prop,v,priority] of old){if(v)n.style.setProperty(prop,v,priority);else n.style.removeProperty(prop);}managed.delete(n);}
 function paint(n){
  if(!n.isConnected||n.closest(excluded)||n.closest('[hidden]')||!n.getClientRects().length)return;
  // Container owns the actual background; skip nested glyph if the enclosing
  // icon is already managed. Paint SVG strokes/fills via currentColor rules.
  const wrapper=n.parentElement?.closest(iconSelector);
  if(wrapper&&wrapper!==n)return;
  if(!managed.has(n))managed.set(n,['color','--ap-icon-ink','--ap-icon-backing'].map(p=>[p,n.style.getPropertyValue(p),n.style.getPropertyPriority(p)]));
  const preferred=hex((parsed(getComputedStyle(n).color)||{rgb:[0,0,0]}).rgb);
  const nav=n.closest('#sidebar .nav-item,#sidebar .nav-group-toggle');
  const active=nav?.classList.contains('active');
  const tone=iconTone(surfaces(n),active?null:preferred);if(!tone)return;
  set(n,'color',tone.ink);set(n,'--ap-icon-ink',tone.ink);set(n,'--ap-icon-backing',tone.backing||'transparent');
  n.setAttribute('data-ap-icon','');n.toggleAttribute('data-ap-icon-backed',Boolean(tone.backing));
  if(nav){
   const label=nav.querySelector('.nav-label');
   if(active){for(const el of [nav,label].filter(Boolean)){if(!managed.has(el))managed.set(el,[['color',el.style.getPropertyValue('color'),el.style.getPropertyPriority('color')]]);set(el,'color',tone.ink);}}
   else{restore(nav);if(label)restore(label);}
  }
 }
 function schedule(all=false,target){
  full=full||all;if(target&&target.nodeType===1)pending.add(target);
  if(queued)return;queued=true;requestAnimationFrame(()=>{
   queued=false;const nodes=new Set();
   if(full)document.querySelectorAll(iconSelector).forEach(n=>nodes.add(n));
   else for(const target of pending){if(target.matches(iconSelector))nodes.add(target);target.querySelectorAll(iconSelector).forEach(n=>nodes.add(n));const own=target.closest(iconSelector);if(own)nodes.add(own);}
   full=false;pending.clear();for(const n of nodes)paint(n);
  });
 }
 const iconObserver=new MutationObserver(records=>{
  for(const r of records){
   if(r.target===root){schedule(true);continue;}
   if(r.type==='childList'){for(const n of r.addedNodes)if(n.nodeType===1)schedule(false,n);}
   else schedule(false,r.target);
  }
 });
 iconObserver.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','data-theme','data-ui-theme','data-color-mode']});
 new MutationObserver(()=>schedule(true)).observe(root,{attributes:true,attributeFilter:['style']});
 document.addEventListener('dashboard-theme-change',()=>schedule(true));
 document.addEventListener('attendigo:portal-ready',()=>schedule(true));
 window.addEventListener('pageshow',()=>schedule(true));
 window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>schedule(true));
 // Re-evaluate hovered/focused controls and on breakpoint changes without polling.
 document.addEventListener('pointerover',e=>{const control=e.target.closest?.('button,a');if(control)schedule(false,control);},true);
 document.addEventListener('pointerout',e=>{const control=e.target.closest?.('button,a');if(control)schedule(false,control);},true);
 document.addEventListener('focusin',e=>schedule(false,e.target));document.addEventListener('focusout',e=>schedule(false,e.target));
 window.addEventListener('resize',()=>schedule(true),{passive:true});
 schedule(true);
 if(location.pathname==='/portal.html'){
  const sync=()=>{const brand=root.style.getPropertyValue('--brand').trim();if(valid(brand))apply(brand);};
  sync();new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['style']});
 }else if(['/student-portal.html','/parent-portal.html'].includes(location.pathname)){
  // One school-scoped read at entry; no polling and no client-side persisted
  // cross-account branding. Principal gets the color in its existing overview.
  const headers={};try{const token=sessionStorage.getItem('schoolAttendance.accessToken');if(token)headers.Authorization='Bearer '+token;}catch{}
  fetch('/api/school/branding',{credentials:'same-origin',cache:'no-store',headers}).then(r=>r.ok?r.json():null).then(d=>{if(valid(d?.branding?.brandColor))apply(d.branding.brandColor);}).catch(()=>{});
 }
})();
