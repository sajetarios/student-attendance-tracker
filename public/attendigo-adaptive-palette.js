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
 if(typeof module!=='undefined'&&module.exports){module.exports={build,contrast,ink};return;}
 const root=document.documentElement;let current=null;
 function apply(input){
  const p=build(input);if(current===p.nav)return;current=p.nav;
  const vars={'--ap-nav':p.nav,'--ap-nav-ink':p.navInk,'--ap-primary':p.primary,'--ap-primary-ink':p.primaryInk,'--ap-tint':p.tint,'--ap-dark-tint':p.darkTint};
  p.cards.forEach((c,i)=>{vars['--ap-card-'+(i+1)]=c;vars['--ap-ink-'+(i+1)]=p.cardInk[i];});
  for(const [name,value] of Object.entries(vars))root.style.setProperty(name,value);
  root.dataset.adaptivePalette='true';
 }
 window.AttendigoPalette={apply,build};apply();
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
