'use strict';
(() => {
 const mounted=new WeakSet(),interval=30*60*1000+Math.floor(Math.random()*120000);
 function mount(root){
  if(!root||mounted.has(root))return;mounted.add(root);
  root.classList.add('ax-live-weather');
  root.innerHTML='<div class="ax-weather-heading"><div><span class="ax-weather-kicker">SCHOOL SAFETY</span><h3>Weather &amp; heat index</h3></div><button type="button" class="outline-button ax-weather-refresh" aria-label="Refresh campus weather" title="Refresh campus weather"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></svg></button></div><label class="ax-weather-campus" hidden>Campus<select aria-label="Weather campus"></select></label><p class="ax-weather-status" role="status">Loading campus forecast…</p><button type="button" class="quiet-button ax-weather-setup" hidden>Set up campus location</button><div class="ax-weather-readings" hidden><div class="ax-weather-main"><svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="30" cy="15" r="9"/><path d="M30 2v3M30 25v3M17 15h3M40 15h5M21 6l3 3M38 6l-3 3M11 40a8 8 0 0 1 0-16 11 11 0 0 1 21 2 7 7 0 0 1 0 14z"/></svg><strong class="ax-weather-temp">—</strong><span class="ax-weather-condition"></span></div><div class="ax-weather-heat"><span>Heat index</span><strong>—</strong><span class="ax-heat-band"></span></div><div class="ax-weather-extra"><span>Humidity <strong class="ax-weather-humidity">—</strong></span><span>Wind <strong class="ax-weather-wind">—</strong></span></div><div class="ax-weather-hour-heading"><strong>Next 6 hours</strong><span>Swipe to explore</span></div><div class="ax-weather-hourly" tabindex="0" role="region" aria-label="Scrollable hourly forecast"></div><p class="ax-weather-brief"></p></div><div class="ax-weather-footer"><small class="ax-weather-credit">Forecast: <a href="https://www.met.no/" target="_blank" rel="noopener noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · Adapted by Attendigo (heat index calculated)</small><button type="button" class="outline-button ax-weather-info" aria-label="Forecast and safety information" aria-expanded="false" title="Forecast and safety information"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 11v5M12 8h.01"/></svg></button><div class="ax-weather-info-panel" hidden><p class="ax-weather-observed"></p><p class="ax-weather-disclaimer">Estimated outdoor conditions and calculated heat index, not a classroom sensor or official class suspension notice. Follow LGU, DepEd and <a href="https://www.pagasa.dost.gov.ph/weather/heat-index" target="_blank" rel="noopener noreferrer">PAGASA advisories</a>.</p></div></div>';
  const $=s=>root.querySelector(s),status=$('.ax-weather-status'),readings=$('.ax-weather-readings'),select=$('select'),refresh=$('.ax-weather-refresh');
  const setup=$('.ax-weather-setup');const principalSetup=document.getElementById('trustedCampusSettings');
  const info=$('.ax-weather-info'),infoPanel=$('.ax-weather-info-panel');
  function toggleInfo(open){infoPanel.hidden=!open;info.setAttribute('aria-expanded',String(open));}
  info.addEventListener('click',()=>toggleInfo(infoPanel.hidden));
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!infoPanel.hidden){toggleInfo(false);info.focus();}});
  let running=false,lastAttempt=0,lastData=null;
  setup.addEventListener('click',()=>{const menu=document.getElementById('principalMore');if(!principalSetup||!menu||!Array.from(menu.options).some(o=>o.value==='security'))return;menu.value='security';menu.dispatchEvent(new Event('change',{bubbles:true}));principalSetup.open=true;const form=document.getElementById('trustedCampusForm');if(form?.closest('details'))form.closest('details').open=true;principalSetup.scrollIntoView({block:'start'});principalSetup.querySelector('summary')?.focus({preventScroll:true});});
  const fmt=(v,suffix='')=>typeof v==='number'&&Number.isFinite(v)?Math.round(v)+suffix:'—';
  const local=t=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t));
  function display(d,offline=false){
   const w=d?.weather;if(!w||!Number.isFinite(Date.parse(w.validAt))||Math.abs(Date.now()-Date.parse(w.validAt))>2*60*60*1000||!Number.isFinite(Date.parse(w.checkedAt))||Date.now()-Date.parse(w.checkedAt)>2*60*60*1000){readings.hidden=true;return false;}
   readings.hidden=false;root.dataset.condition=String(w.condition||'').toLowerCase();$('.ax-weather-temp').textContent=fmt(w.temperature,'°C');$('.ax-weather-condition').textContent=w.condition||'';
   $('.ax-weather-heat strong').textContent=fmt(w.heatIndex,'°C');$('.ax-heat-band').textContent=w.heatBand||'';
   $('.ax-weather-heat').dataset.band=w.heatBand||'';
   $('.ax-weather-humidity').textContent=fmt(w.humidity,'%');$('.ax-weather-wind').textContent=fmt(w.windKph,' km/h');
   const hours=$('.ax-weather-hourly');hours.replaceChildren();
   for(const h of (w.hourly||[]).slice(0,6)){
    if(!Number.isFinite(Date.parse(h.time)))continue;
    const item=document.createElement('div');for(const s of [new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric'}).format(new Date(h.time)),fmt(h.temperature,'°C'),'Heat '+fmt(h.heatIndex,'°C'),'Rain '+(typeof h.rainMm==='number'?h.rainMm.toFixed(1)+' mm':'—')]){const v=document.createElement(item.children.length===1?'strong':'span');v.textContent=s;item.append(v);}hours.append(item);
   }
   $('.ax-weather-brief').textContent='Forecast '+local(w.validAt)+' · Checked '+new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(w.checkedAt));
   $('.ax-weather-observed').textContent='Forecast for '+local(w.validAt)+' · Model updated '+local(w.modelUpdatedAt)+' · Checked '+local(w.checkedAt)+' · Philippine time';
   status.textContent=(d.campus?.name||'Campus')+' · '+(offline||d.status==='stale'?'Last available estimate — not live':'Current-hour forecast estimate');
   return true;
  }
  async function load(force=false){
   if(running||!root.isConnected||document.hidden||root.closest('[hidden]')||(!force&&Date.now()-lastAttempt<interval))return;
   if(!navigator.onLine){if(!display(lastData,true)){readings.hidden=true;status.textContent='Offline — current weather unavailable.';}return;}
   running=true;lastAttempt=Date.now();refresh.disabled=true;select.disabled=true;
   try{
    const headers={};try{const token=sessionStorage.getItem('schoolAttendance.accessToken');if(token)headers.Authorization='Bearer '+token;}catch{}
    const response=await fetch('/api/school/weather'+(select.value?'?campus='+encodeURIComponent(select.value):''),{credentials:'same-origin',cache:'no-store',headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Weather unavailable');
    const data=await response.json();const chosen=data.campus?.id||'';
    if(Array.isArray(data.campuses)){select.replaceChildren();for(const c of data.campuses){const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.name;select.append(opt);}select.value=chosen;$('.ax-weather-campus').hidden=data.campuses.length<2;}
    lastData=data;
    setup.hidden=!(data.status==='no_campus'&&principalSetup);
    if(!display(data)){readings.hidden=true;status.textContent=data.status==='no_campus'?(principalSetup?'Register your verified school campus to display its forecast. Campus registration also sets attendance security boundaries.':'No campus location registered. Ask your Principal to configure it.'):'Current weather unavailable.';}
   }catch{if(!display(lastData,true)){readings.hidden=true;status.textContent='Current weather unavailable.';}}
   finally{running=false;refresh.disabled=false;select.disabled=false;}
  }
  refresh.addEventListener('click',()=>load(true));select.addEventListener('change',()=>{lastData=null;readings.hidden=true;status.textContent='Loading selected campus…';load(true);});
  document.addEventListener('visibilitychange',()=>load());window.addEventListener('online',()=>load());window.addEventListener('offline',()=>{if(!display(lastData,true)){readings.hidden=true;status.textContent='Offline — current weather unavailable.';}});
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load(Boolean(lastData?.status==='no_campus'));});observer.observe(root);
  setInterval(()=>{if(root.isConnected&&root.getBoundingClientRect().width>0)load();},interval);
 }
 window.AttendigoSchoolWeather={mount};
 document.querySelectorAll('[data-school-weather]').forEach(mount);
 document.addEventListener('attendigo:portal-ready',()=>document.querySelectorAll('[data-school-weather]').forEach(mount));
})();
