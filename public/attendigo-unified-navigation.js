/* Unified navigation icon presentation; no links, handlers, visibility or role changes. */
(() => {
 'use strict';
 const paths={
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  clipboard:'<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4.5h6V2H9zM9 13l2 2 4-4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book:'<path d="M12 7c-3-2-6-2-10-1v14c4-1 7-1 10 1m0-14c3-2 6-2 10-1v14c-4-1-7-1-10 1V7Z"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l-2 2a1.6 1.6 0 0 0-1.8-.3l-1.1.5-.4 2.1h-2.8l-.4-2.1-1.1-.5a1.6 1.6 0 0 0-1.8.3l-2-2a1.6 1.6 0 0 0 .3-1.8L6 14l-2-.4v-2.8l2-.4.5-1.1a1.6 1.6 0 0 0-.3-1.8l2-2a1.6 1.6 0 0 0 1.8.3l1.1-.5.4-2.1h2.8l.4 2.1 1.1.5a1.6 1.6 0 0 0 1.8-.3l2 2a1.6 1.6 0 0 0-.3 1.8l.5 1.1 2 .4v2.8l-2 .4-.4 1.1Z"/>',
  report:'<path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 17v-4m4 4V11m4 6v-3"/>',
  sync:'<path d="M20 7a8 8 0 0 0-14-2L4 7m0-4v4h4M4 17a8 8 0 0 0 14 2l2-2m0 4v-4h-4"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 8 10-8"/>',
  star:'<path d="m12 2 2.7 6.7L22 12l-7.3 3.3L12 22l-2.7-6.7L2 12l7.3-3.3L12 2Z"/>',
  school:'<path d="M3 22V8l9-5 9 5v14M8 22v-8h8v8M3 10h18M10 7h4"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>'
 };
 const map={
  staffNavToggle:'users',requestsApprovalsNav:'clipboard',guardianApprovalsNav:'shield',
  academicAdminNav:'calendar',personalAttendanceNavGroup:'clock',
  classAttendanceNav:'clipboard',lunchQrAdminNav:'shield',
  form48ReportsNav:'report',teacherLunchQrNav:'shield',
  myGateAttendanceNav:'clock',officialBusinessNav:'clipboard',
  sf2Nav:'report',cloudSyncNav:'sync',smsNav:'mail',
  schoolBrandingNav:'school',staffNavWrapper:'users',
  attendanceManagementNavGroup:'clock',offlineScanReviewsNav:'clipboard',
  operationsNavGroup:'settings',reportsNavGroup:'report',
  settingsNavGroup:'settings',studentRecordsNavGroup:'users'
 };
 function update(){
  const sidebar=document.getElementById('sidebar');if(!sidebar)return;
  for(const [id,name] of Object.entries(map)){
   const host=document.getElementById(id);
   if(!host||!sidebar.contains(host))continue;
   const target=host.matches('.nav-item,.nav-group-toggle')?host:host.querySelector(':scope > .nav-group-toggle');
   const icon=target?.querySelector(':scope > .nav-icon');
   if(!icon||icon.dataset.unifiedIcon||!paths[name])continue;
   // Only replace legacy text glyphs. Keep existing icon artwork, links and events intact.
   if(icon.querySelector('svg,img'))continue;
   icon.replaceChildren();
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   svg.setAttribute('viewBox','0 0 24 24');
   svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
   svg.setAttribute('stroke-width','1.9');svg.setAttribute('stroke-linecap','round');
   svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
   svg.innerHTML=paths[name];icon.append(svg);icon.dataset.unifiedIcon=name;
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',update,{once:true});
 else update();
})();