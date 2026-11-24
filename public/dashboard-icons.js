'use strict';
/* One local stroke-icon vocabulary; no external font or CDN dependency. */
(function () {
  const paths = {
    'id-card':'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M14 10h4m-4 4h4M6 16h6"/>',
    'user-cog':'<circle cx="10" cy="8" r="3"/><path d="M4 20v-2a6 6 0 0 1 10-4.5M18 15.5l.8 1.1 1.4.3-.5 1.4.5 1.4-1.4.3-.8 1.1-1.2-.9-1.4.2-.2-1.5-1-1 1-1 .2-1.5 1.4.2Z"/>',
    'book-user':'<path d="M12 6C9 4 6 4 3 5v14c4-1 7 0 9 2 2-2 5-3 9-2V5c-3-1-6-1-9 1Zm0 0v15"/><path d="M7 10h2m-2 4h2m6-4h2m-2 4h2"/>',
    'clipboard-check':'<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    'file-chart':'<path d="M6 2h9l4 4v16H6zM15 2v5h4M9 18v-4m3 4v-7m3 7v-3"/>',
    'mail':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m3 7 9 7 9-7"/>',
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
    building:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 12h2m4 0h2M9 21v-5h6v5"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>',
    'panel-collapse':'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>',
    'panel-expand':'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m4-11 3 3-3 3"/>'
  };
  function html(name) { return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[name]||paths.calendar)+'</svg>'; }
  const controls={refreshDashboard:'refresh',refreshButton:'refresh',logoutButton:'logout',platformRefreshButton:'refresh',studentRefresh:'refresh',studentLogout:'logout',showScheduleForm:'plus',scheduleAdjustmentShortcut:'swap',scheduleSettingsShortcut:'settings',saveScheduleButton:'check',backButton:'swap',saveScheduleAdjustment:'check'};
  const nav={dashboardNav:'grid',studentsNav:'graduation',studentAccountsNav:'id-card',adminStudentAccountsNav:'id-card',teachersNav:'users',parentsNav:'users',requestsApprovalsNav:'clipboard-check',guardianApprovalsNav:'shield',classAttendanceNav:'clipboard-check',sf2Nav:'file-chart',plannerNav:'calendar',schedulesNav:'calendar',academicAdminNav:'book',cloudSyncNav:'swap',smsNav:'mail',schoolBrandingNav:'school'};
  const views={dashboard:'grid',students:'graduation',studentAccounts:'id-card',teachers:'users',parents:'users',
    classAttendance:'clipboard-check',sf2:'file-chart',schedules:'calendar',planner:'calendar',cloudSync:'swap',
    schoolBranding:'school',platform:'shield'};
  const groups={users:'users',people:'graduation',academics:'book',operations:'settings',reports:'file-chart',settings:'settings'};
  const staff={staffNavToggle:'users',directory:'id-card',accounts:'users',permissions:'shield',departments:'building'};
  const actionIcons={accounts:'users',permissions:'shield',departments:'building'};
  const shortIcons={students:'graduation',teachers:'users',schedules:'calendar',sf2:'report'};
  function render(){
    document.querySelectorAll('.sidebar .nav-item,.sidebar .nav-group-toggle').forEach(button=>{
      const glyph=button.querySelector('.nav-icon');
      const symbol=staff[button.id]||staff[button.dataset.staffSection]||nav[button.id]||views[button.dataset.view]||groups[button.dataset.navGroup];
      // Replace inconsistent text glyphs and older line art with a single icon vocabulary.
      if(glyph&&symbol&&glyph.dataset.iconName!==symbol){
        glyph.innerHTML=html(symbol);
        glyph.dataset.iconName=symbol;
      }
    });
    document.querySelectorAll('.admin-dashboard-action[data-admin-go]').forEach(button=>{
      const icon=button.querySelector('.admin-action-icon');
      const name=actionIcons[button.dataset.adminGo];
      if(icon&&name&&!icon.querySelector('.ui-icon'))icon.innerHTML=html(name);
      const arrow=button.querySelector(':scope > b');
      if(arrow&&!arrow.querySelector('.ui-icon'))arrow.innerHTML=html('chevron');
    });
    document.querySelectorAll('.quick-action[data-go]').forEach(button=>{
      const glyph=button.querySelector('.quick-action-icon');
      const name=shortIcons[button.dataset.go];
      if(glyph&&name&&!glyph.querySelector('.ui-icon'))glyph.innerHTML=html(name);
      const arrow=button.querySelector(':scope > b');
      if(arrow&&!arrow.querySelector('.ui-icon'))arrow.innerHTML=html('chevron');
    });
    for(const [id,name] of Object.entries(nav)){
      const el=document.querySelector('#'+id+' .nav-icon');
      if(el&&!el.querySelector('.ui-icon'))el.innerHTML=html(name);
    }
    document.querySelectorAll('[data-ui-icon]').forEach(el=>{if(!el.querySelector('.ui-icon'))el.innerHTML=html(el.dataset.uiIcon);});
    for(const [id,name] of Object.entries(controls)){
      const el=document.getElementById(id);if(!el)continue;
      if(name==='refresh'){
        const glyphs=[...el.querySelectorAll('svg,.ui-icon')];
        for(const node of [...el.childNodes])if(node.nodeType===3&&/^[\s↻⟳⟲🔄]+/.test(node.textContent)){const label=node.textContent.replace(/^[\s↻⟳⟲🔄]+/u,'');if(label!==node.textContent)node.textContent=label;}
        for(const node of [...el.children])if(node.tagName==='SPAN'&&/^[\s↻⟳⟲🔄]+$/u.test(node.textContent))node.remove();
        if(glyphs.length>1)glyphs.slice(1).forEach(icon=>icon.remove());
        if(el.querySelector('.ui-icon,svg'))continue;
      }else if(el.querySelector('.ui-icon'))continue;
      const first=el.firstChild;
      if(first?.nodeType===3)first.textContent=first.textContent.replace(/^[＋+⇄⚙↻←✓]\s*/, '');
      el.insertAdjacentHTML('afterbegin',html(name));
    }
  }
  window.DashboardIcons={html,render};
  function init(){const style=document.createElement('style');style.textContent='#refreshButton::before,#refreshButton::after,#platformRefreshButton::before,#platformRefreshButton::after,#studentRefresh::before,#studentRefresh::after,#refreshDashboard::before,#refreshDashboard::after{content:none!important;display:none!important}';document.head.append(style);render();new MutationObserver(render).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
