'use strict';
(() => {
 const mounted=new WeakSet(),interval=30*60*1000;
 function mount(root){
  if(!root||mounted.has(root))return;mounted.add(root);
  root.classList.add('ax-live-weather');
  root.innerHTML='<div class="ax-weather-heading"><div><span class="ax-weather-kicker">SCHOOL SAFETY</span><h3>Weather &amp; heat index</h3></div><button type="button" class="outline-button ax-weather-refresh" aria-label="Refresh campus weather">Refresh</button></div><label class="ax-weather-campus" hidden>Campus<select aria-label="Weather campus"></select></label><p class="ax-weather-status" role="status">Loading campus forecast…</p><div class="ax-weather-readings" hidden><div class="ax-weather-main"><svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="30" cy="15" r="9"/><path d="M30 2v3M30 25v3M17 15h3M40 15h5M21 6l3 3M38 6l-3 3M11 40a8 8 0 0 1 0-16 11 11 0 0 1 21 2 7 7 0 0 1 0 14z"/></svg><strong class="ax-weather-temp">—</strong><span class="ax-weather-condition"></span></div><div class="ax-weather-heat"><span>Heat index</span><strong>—</strong><span class="ax-heat-band"></span></div><p class="ax-weather-extra"></p><div class="ax-weather-hourly" aria-label="Next six forecast hours"></div><p class="ax-weather-observed"></p></div><p class="ax-weather-disclaimer">Outdoor area estimate, not a classroom sensor or official suspension notice. Review LGU, DepEd and <a href="https://www.pagasa.dost.gov.ph/weather/heat-index" target="_blank" rel="noopener noreferrer">PAGASA advisories</a>.</p><small>Data: <a href="https://www.weatherapi.com/" target="_blank" rel="noopener noreferrer">WeatherAPI.com</a></small>';
  const $=s=>root.querySelector(s),status=$('.ax-weather-status'),readings=$('.ax-weather-readings'),select=$('select'),refresh=$('.ax-weather-refresh');
  let running=false,lastAttempt=0,lastData=null;
  const fmt=(v,suffix='')=>typeof v==='number'&&Number.isFinite(v)?Math.round(v)+suffix:'—';
  const local=t=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t));
  function display(d,offline=false){
   const w=d?.weather;if(!w||!Number.isFinite(Date.parse(w.observedAt))||Date.now()-Date.parse(w.observedAt)>2*60*60*1000){readings.hidden=true;return false;}
   readings.hidden=false;$('.ax-weather-temp').textContent=fmt(w.temperature,'°C');$('.ax-weather-condition').textContent=w.condition||'';
   $('.ax-weather-heat strong').textContent=fmt(w.heatIndex,'°C');$('.ax-heat-band').textContent=w.heatBand||'';
   $('.ax-weather-heat').dataset.band=w.heatBand||'';
   $('.ax-weather-extra').textContent='Humidity '+fmt(w.humidity,'%')+' · Wind '+fmt(w.windKph,' km/h');
   const hours=$('.ax-weather-hourly');hours.replaceChildren();
   for(const h of (w.hourly||[]).slice(0,6)){
    if(!Number.isFinite(Date.parse(h.time)))continue;
    const item=document.createElement('div');for(const s of [new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric'}).format(new Date(h.time)),fmt(h.temperature,'°C'),'Heat '+fmt(h.heatIndex,'°C'),'Rain '+fmt(h.rainChance,'%')]){const v=document.createElement('span');v.textContent=s;item.append(v);}hours.append(item);
   }
   $('.ax-weather-observed').textContent='Observed '+local(w.observedAt)+' · Philippine time';
   status.textContent=(d.campus?.name||'Campus')+' · '+(offline||d.status==='stale'?'Last available estimate — not live':'Current provider estimate');
   return true;
  }
  async function load(force=false){
   if(running||!root.isConnected||document.hidden||root.closest('[hidden]')||(!force&&Date.now()-lastAttempt<interval))return;
   if(!navigator.onLine){if(!display(lastData,true)){readings.hidden=true;status.textContent='Offline — current weather unavailable.';}return;}
   running=true;lastAttempt=Date.now();refresh.disabled=true;
   try{
    const headers={};try{const token=sessionStorage.getItem('schoolAttendance.accessToken');if(token)headers.Authorization='Bearer '+token;}catch{}
    const response=await fetch('/api/school/weather'+(select.value?'?campus='+encodeURIComponent(select.value):''),{credentials:'same-origin',cache:'no-store',headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Weather unavailable');
    const data=await response.json();const chosen=data.campus?.id||'';
    if(Array.isArray(data.campuses)){select.replaceChildren();for(const c of data.campuses){const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.name;select.append(opt);}select.value=chosen;$('.ax-weather-campus').hidden=data.campuses.length<2;}
    lastData=data;
    if(!display(data)){readings.hidden=true;status.textContent=data.status==='no_campus'?'Campus location required. Ask the Principal to register the school campus.':data.status==='not_configured'?'Live weather provider is not configured yet.':'Current weather unavailable.';}
   }catch{if(!display(lastData,true)){readings.hidden=true;status.textContent='Current weather unavailable.';}}
   finally{running=false;refresh.disabled=false;}
  }
  refresh.addEventListener('click',()=>load(true));select.addEventListener('change',()=>{lastData=null;readings.hidden=true;status.textContent='Loading selected campus…';load(true);});
  document.addEventListener('visibilitychange',()=>load());window.addEventListener('online',()=>load());window.addEventListener('offline',()=>{if(!display(lastData,true)){readings.hidden=true;status.textContent='Offline — current weather unavailable.';}});
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load();});observer.observe(root);
  setInterval(()=>{if(root.isConnected&&root.getBoundingClientRect().width>0)load();},interval);
 }
 window.AttendigoSchoolWeather={mount};
 document.querySelectorAll('[data-school-weather]').forEach(mount);
 document.addEventListener('attendigo:portal-ready',()=>document.querySelectorAll('[data-school-weather]').forEach(mount));
})();
