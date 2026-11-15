/* Adaptive sidebar contrast and brand lockup. No changes to school data or permissions. */
(() => {
 const sidebar=document.getElementById('sidebar');if(!sidebar)return;
 const root=document.documentElement;
 const brand=sidebar.querySelector('.attendigo-brand');
 if(brand&&!brand.querySelector('.attendigo-adaptive-logo')){
   const logo=document.createElement('div');logo.className='attendigo-adaptive-logo';logo.setAttribute('role','img');logo.setAttribute('aria-label','Attendigo');
   logo.innerHTML='<span class="attendigo-a" aria-hidden="true">✓</span><span class="attendigo-name" aria-hidden="true">Attendigo</span>';
   brand.appendChild(logo);
 }
 const parse=(s)=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(m)return m[1].split(',').slice(0,3).map(Number);const h=s.trim().replace('#','');if(/^[0-9a-f]{6}$/i.test(h))return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));return [28,30,58]};
 const luminance=(a)=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const mix=(a,b,t)=>a.map((v,i)=>Math.round(v*(1-t)+b[i]*t));
 const rgb=a=>'rgb('+a.join(',')+')';
 let previous='';
 function apply(){
  const bg=parse(getComputedStyle(sidebar).backgroundColor);
  const key=bg.join(',')+'|'+root.className+'|'+root.getAttribute('data-theme');if(key===previous)return;previous=key;
  const white=[255,255,255],navy=[12,22,50],ink=contrast(bg,white)>=contrast(bg,navy)?white:navy;
  const light=luminance(ink)>.5;
  const muted=mix(bg,ink,light?.82:.76);
  const border=mix(bg,ink,.28);
  let selected=mix(bg,light?[83,63,204]:[210,223,255],light?.30:.35);
  for(let n=0;n<12&&Math.max(contrast(selected,white),contrast(selected,navy))<4.5;n++)selected=mix(selected,light?navy:white,.12);
  const selectedInk=contrast(selected,white)>=contrast(selected,navy)?white:navy;
  sidebar.style.setProperty('--side-ink',rgb(ink));sidebar.style.setProperty('--side-muted',rgb(muted));
  sidebar.style.setProperty('--side-border',rgb(border));sidebar.style.setProperty('--side-selected',rgb(selected));
  sidebar.style.setProperty('--side-selected-ink',rgb(selectedInk));
  sidebar.style.setProperty('--side-hover',rgb(mix(bg,ink,.12)));
  sidebar.dataset.logoContrast=light?'light':'dark';
 }
 const observer=new MutationObserver(()=>requestAnimationFrame(apply));
 observer.observe(root,{attributes:true,attributeFilter:['style','class','data-theme','data-color-mode']});
 observer.observe(sidebar,{attributes:true,attributeFilter:['style','class']});
 if(window.matchMedia){const q=matchMedia('(prefers-color-scheme: dark)');q.addEventListener?.('change',apply)}
 apply();window.addEventListener('pageshow',apply);
})();
