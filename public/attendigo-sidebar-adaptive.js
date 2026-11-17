/* Attendigo adaptive sidebar: never edit or recolor an uploaded school emblem.
   A school's --sidebar background is authoritative; only product logo variants
   and navigation contrast adapt. No tenant/account data stored in the browser. */
(() => {
  'use strict';
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const root = document.documentElement;
  const brand = sidebar.querySelector('.attendigo-brand');
  // Preserve the original multicolor approved mark on any school sidebar color.
  const symbolAsset = '/assets/attendigo-symbol-transparent.svg?v=2';
  const logo = brand?.querySelector('img.attendigo-logo') || brand?.querySelector('img');
  if (brand) {
    // Prevent duplicate product logos from legacy overlays; never query school emblem.
    brand.querySelectorAll('img').forEach((node, index) => {
      if (index > 0) node.remove();
    });
  }
  if (logo) {
    logo.className = 'attendigo-logo';
    logo.alt = 'Attendigo — Every learner counts.';
    logo.width = 48;
    logo.height = 48;
  }
  const clamp = n => Math.min(255, Math.max(0, Math.round(Number(n) || 0)));
  const color = input => {
    const text = String(input || '').trim();
    const match = text.match(/rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)/i);
    if (match) return match.slice(1, 4).map(clamp);
    const hex = text.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
    if (hex) {
      let value = hex[1];
      if (value.length === 3 || value.length === 4) value = value.split('').map(c => c + c).join('');
      return [0,2,4].map(i => parseInt(value.slice(i,i+2),16));
    }
    return null;
  };
  const luminance = channels => channels.map(v => {
    const c = v / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
  const contrast = (a,b) => {
    const x=luminance(a), y=luminance(b);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  };
  const mix=(a,b,t)=>a.map((v,i)=>clamp(v*(1-t)+b[i]*t));
  const rgb=a=>'rgb('+a.join(',')+')';
  const white=[255,255,255], black=[0,0,0];

  function backgroundSamples() {
    const computed=getComputedStyle(sidebar);
    const main=color(computed.backgroundColor) ||
      color(computed.getPropertyValue?.('--sidebar')) ||
      color(getComputedStyle(root).getPropertyValue?.('--sidebar')) ||
      [25,42,68];
    const image=String(computed.backgroundImage||'');
    // Computed gradient colors are resolved RGB/hex. Sample every declared stop,
    // not only the flat fallback, so mixed backgrounds trigger a neutral backing.
    const gradientColors=[];
    for(const match of image.matchAll(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/ig)) {
      const parsed=color(match[0]);
      if(parsed) gradientColors.push(parsed);
    }
    return gradientColors.length ? gradientColors.slice(0,10) : [main];
  }
  const minContrast=(colors,ink)=>Math.min(...colors.map(bg=>contrast(bg,ink)));
  function legibleMix(colors,background,target,ratio){
    let low=0,high=1;
    for(let i=0;i<12;i++){
      const mid=(low+high)/2;
      if(minContrast(colors,mix(background,target,mid))>=ratio)high=mid;
      else low=mid;
    }
    return mix(background,target,high);
  }
  let previous='';
  function apply(){
    const samples=backgroundSamples();
    const average=[0,1,2].map(i=>clamp(samples.reduce((sum,bg)=>sum+bg[i],0)/samples.length));
    const key=samples.map(x=>x.join(',')).join('|')+'|'+root.className+'|'+root.getAttribute?.('data-ui-theme');
    if(key===previous)return;
    previous=key;
    const whiteScore=minContrast(samples,white),blackScore=minContrast(samples,black);
    const useWhite=whiteScore>=blackScore;
    const ink=useWhite?white:black;
    const score=Math.max(whiteScore,blackScore);
    const backed=score<4.5;
    const contrastBase=backed?(useWhite?[12,26,47]:[250,252,255]):average;
    const colors=backed?[contrastBase]:samples;
    const muted=legibleMix(colors,contrastBase,ink,4.5);
    const border=legibleMix(colors,contrastBase,ink,3);
    const hover=mix(contrastBase,ink,.12);
    let selected=mix(contrastBase,ink,.22);
    const selectedInk=contrast(selected,white)>=contrast(selected,black)?white:black;
    // Preserve 4.5:1 active text readability even with custom school colors.
    if(contrast(selected,selectedInk)<4.5)selected=mix(contrastBase,selectedInk,.35);
    const finalSelectedInk=contrast(selected,white)>=contrast(selected,black)?white:black;
    const hoverInk=contrast(hover,white)>=contrast(hover,black)?white:black;
    const focus=useWhite?white:black;
    for(const [name,value] of Object.entries({
      '--side-ink':rgb(ink),
      '--side-muted':rgb(muted),
      '--side-border':rgb(border),
      '--side-selected':rgb(selected),
      '--side-selected-ink':rgb(finalSelectedInk),
      '--side-hover':rgb(hover),
      '--side-hover-ink':rgb(hoverInk),
      '--side-focus':rgb(focus),
      '--side-logo-back':useWhite?'rgba(12,26,47,.96)':'rgba(250,252,255,.97)'
    })) sidebar.style.setProperty(name,value);
    sidebar.dataset.logoContrast=useWhite?'light':'dark';
    sidebar.dataset.logoBacked=backed?'true':'false';
    const asset=symbolAsset;
    if(logo && logo.getAttribute?.('src')!==asset && logo.src!==asset)logo.src=asset;
  }
  const observer=new MutationObserver(()=>requestAnimationFrame(apply));
  observer.observe(root,{attributes:true,attributeFilter:['style','class','data-theme','data-color-mode','data-ui-theme']});
  observer.observe(sidebar,{attributes:true,attributeFilter:['style','class']});
  if(window.matchMedia){
    const q=window.matchMedia('(prefers-color-scheme: dark)');
    q.addEventListener?.('change',apply);
  }
  document.addEventListener('dashboard-theme-change',()=>requestAnimationFrame(apply));
  apply();
  window.addEventListener('pageshow',apply);
})();
