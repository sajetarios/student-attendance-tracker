'use strict';
/* One local stroke-icon vocabulary; no external font or CDN dependency. */
(function () {
  const paths = {
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    book:'<path d="M12 6C9 3 5 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    swap:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
    settings:'<path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    palette:'<path d="M21 12a9 9 0 1 0-9 9h2a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a2 2 0 0 0 2-2Z"/><path d="M7 9h.01M10 6h.01M15 6h.01M18 10h.01"/>',
    report:'<path d="M14 2H5v20h14V7Zm0 0v5h5M8 17v-3m4 3v-6m4 6v-4"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    logout:'<path d="M9 4H3v16h6m6-12 4 4-4 4m-8-4h12"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    moon:'<path d="M20 14A8 8 0 0 1 10 4a9 9 0 1 0 10 10Z"/>',
    scan:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 12h18M8 8h2v2H8zm6 6h2v2h-2z"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-2 2 3 3m-6 0 3 3"/>',
    school:'<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-7h6v7M8 10h.01M16 10h.01"/>',
    graduation:'<path d="m2 10 10-5 10 5-10 5-10-5ZM6 12v5c4 3 8 3 12 0v-5M22 10v6"/>',
    filter:'<path d="M4 6h16M7 12h10m-7 6h4"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4"/>',
    building:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 12h2m4 0h2M9 21v-5h6v5"/>'
  };
  function html(name) { return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[name]||paths.calendar)+'</svg>'; }
  const controls={refreshButton:'refresh',logoutButton:'logout',platformRefreshButton:'refresh',studentRefresh:'refresh',studentLogout:'logout',showScheduleForm:'plus',scheduleAdjustmentShortcut:'swap',scheduleSettingsShortcut:'settings',saveScheduleButton:'check',refreshButton:'refresh',backButton:'swap',studentRefresh:'refresh',studentLogout:'logout',saveScheduleAdjustment:'check'};
  const nav={dashboardNav:'grid',studentsNav:'book',teachersNav:'users',parentsNav:'users',classAttendanceNav:'check',sf2Nav:'report',schedulesNav:'calendar',academicAdminNav:'book',cloudSyncNav:'swap',schoolBrandingNav:'palette'};
  const views={dashboard:'grid',students:'graduation',teachers:'users',parents:'users',
    classAttendance:'check',sf2:'report',schedules:'calendar',cloudSync:'swap',
    schoolBranding:'palette',platform:'shield'};
  const groups={people:'users',academics:'book'};
  function render(){
    document.querySelectorAll('.side-nav .nav-item,.side-nav .nav-group-toggle').forEach(button=>{
      const glyph=button.querySelector('.nav-icon');
      const symbol=views[button.dataset.view]||groups[button.dataset.navGroup];
      if(glyph&&symbol&&!glyph.querySelector('.ui-icon'))glyph.innerHTML=html(symbol);
    });
    for(const [id,name] of Object.entries(nav)){
      const el=document.querySelector('#'+id+' .nav-icon');
      if(el&&!el.querySelector('.ui-icon'))el.innerHTML=html(name);
    }
    document.querySelectorAll('[data-ui-icon]').forEach(el=>{if(!el.querySelector('.ui-icon'))el.innerHTML=html(el.dataset.uiIcon);});
    for(const [id,name] of Object.entries(controls)){
      const el=document.getElementById(id);if(!el||el.querySelector('.ui-icon'))continue;
      const first=el.firstChild;
      if(first?.nodeType===3)first.textContent=first.textContent.replace(/^[＋+⇄⚙↻←✓]\s*/, '');
      el.insertAdjacentHTML('afterbegin',html(name));
    }
  }
  window.DashboardIcons={html,render};
  function init(){render();new MutationObserver(render).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
