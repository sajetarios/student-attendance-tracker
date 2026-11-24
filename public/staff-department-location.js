'use strict';
// School Admin reviews submitted department locations; Department Head captures
// the location on site. QR verification continues to use only approved points.
(() => {
 const $=id=>document.getElementById(id);
 async function request(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,
   headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'Location request failed ('+response.status+')');
  return body;
 }
 async function getPosition(onProgress){
  if(!window.attendigoPreciseLocation)
   throw Error('Location verification is unavailable. Refresh Attendigo and try again.');
  return window.attendigoPreciseLocation.collectPreciseLocation({onProgress});
 }
 function failure(error){
  if(error?.code===1)return 'Location permission denied. Allow location access in your browser settings.';
  if(error?.code===2)return 'Location unavailable. Enable device location services and retry on site.';
  if(error?.code===3)return 'GPS timed out. Try near a window or outdoors near your department.';
  return error?.message||'Location unavailable.';
 }

 // Browsers control their own native prompt. This help dialog guides users when blocked.
 function isEmbeddedBrowser(){
  return /FBAN|FBAV|FB_IAB|FB4A|FBIOS|Messenger|Instagram|Line\//i.test(navigator.userAgent||'');
 }
 function locationDeviceGuide(){
  const agent=navigator.userAgent||'';
  if(isEmbeddedBrowser())return 'In-app browser (Messenger / Facebook / Instagram)';
  if(/iPad|iPhone|iPod/.test(agent)||(/Macintosh/.test(agent)&&navigator.maxTouchPoints>1))
   return /CriOS|FxiOS|EdgiOS/.test(agent)?'iPhone / iPad (other browser)':'iPhone / iPad (Safari)';
  if(/Android/.test(agent))return 'Android (Chrome)';
  if(/Firefox/.test(agent))return 'Firefox';
  if(/Safari/.test(agent)&&!/Chrome|Chromium|Edg/.test(agent))return 'Mac (Safari)';
  return 'Chrome / Edge (computer)';
 }
 function buildLocationPermissionDialog(startCapture){
  const dialog=document.createElement('dialog');
  dialog.id='staffLocationPermissionDialog';
  dialog.className='staff-location-permission-dialog';
  dialog.setAttribute('aria-labelledby','staffLocationPermissionTitle');
  dialog.setAttribute('aria-describedby','staffLocationPermissionSummary');
  // Static markup only. No private account details or location values are injected.
  dialog.innerHTML=[
   '<div class="staff-location-permission-body">',
   '<div class="staff-location-permission-heading">',
   '<span class="staff-location-permission-symbol" aria-hidden="true">⌖</span>',
   '<div><h2 id="staffLocationPermissionTitle">Enable location access</h2>',
   '<p id="staffLocationPermissionSummary">Attendigo needs your device location to activate the department QR attendance point after GPS validation.</p></div></div>',
   '<p id="staffLocationPermissionMessage" class="staff-location-permission-message"></p>',
   '<div id="staffLocationPermissionHelp" class="staff-location-permission-help" hidden>',
   '<label for="staffLocationPermissionDevice">Choose your device or browser</label>',
   '<select id="staffLocationPermissionDevice">',
   '<option>Chrome / Edge (computer)</option><option>Android (Chrome)</option>',
   '<option>iPhone / iPad (Safari)</option><option>iPhone / iPad (other browser)</option><option>In-app browser (Messenger / Facebook / Instagram)</option><option>Mac (Safari)</option><option>Firefox</option></select>',
   '<ol id="staffLocationPermissionSteps"></ol>',
   '<p class="staff-location-permission-tip">If access still fails, check device Location Services and open Attendigo directly in an HTTPS browser tab.</p></div>',
   '<div class="staff-location-permission-actions">',
   '<button id="staffLocationPermissionCancel" type="button" class="outline-button">Not now</button>',
   '<button id="staffLocationPermissionContinue" type="button" class="primary-button">Allow location</button>',
   '</div></div>'
  ].join('');
  document.body.appendChild(dialog);
  const message=dialog.querySelector('#staffLocationPermissionMessage');
  const help=dialog.querySelector('#staffLocationPermissionHelp');
  const choice=dialog.querySelector('#staffLocationPermissionDevice');
  const steps=dialog.querySelector('#staffLocationPermissionSteps');
  const proceed=dialog.querySelector('#staffLocationPermissionContinue');
  const instructions={
   'Chrome / Edge (computer)':['Click the site controls icon beside the Attendigo website address.','Open Site settings and change Location to Allow.','Reload the Attendigo page, then select Try again.'],
   'Android (Chrome)':['Tap the site controls icon beside the Attendigo website address.','Open Permissions or Site settings, then allow Location.','Enable Location in phone settings and return to Attendigo.'],
   'iPhone / iPad (Safari)':['Open iPhone Settings → Privacy & Security → Location Services. Turn it on.','Select Safari Websites, allow location while using the app, and turn on Precise Location if shown.','In Safari, open Attendigo, tap the page menu beside the address, and set website Location to Allow or Ask. Return here and tap Try GPS again.'],
   'iPhone / iPad (other browser)':['Open iPhone Settings → Privacy & Security → Location Services and enable it.','Allow location for your browser while using it and turn on Precise Location if shown.','Open Attendigo in Safari if your browser still cannot request location.'],
   'In-app browser (Messenger / Facebook / Instagram)':['Open the browser menu (often three dots) and choose Open in browser, Open in Safari, or Open in Chrome if available.','If that option is missing, copy the Attendigo website address and paste it into Safari or Chrome. Sign in there if asked.','Enable location and precise location for that browser, then return to department location and try again.'],
   'Mac (Safari)':['In Safari, open Settings → Websites → Location.','Find Attendigo and change its permission to Allow or Ask.','Check System Settings → Privacy & Security → Location Services if access still fails.'],
   'Firefox':['Select the location or permissions icon beside the website address.','Remove the blocked location permission or allow it in site permissions.','Reload Attendigo and select Try again.']
  };
  function updateSteps(){
   steps.replaceChildren();
   for(const step of instructions[choice.value]||instructions['Chrome / Edge (computer)']){
    const item=document.createElement('li');item.textContent=step;steps.appendChild(item);
   }
  }
  choice.value=locationDeviceGuide();
  choice.addEventListener('change',updateSteps);
  updateSteps();
  function render(state){
   const denied=state==='denied',unavailable=state==='unavailable';
   help.hidden=!denied&&!unavailable;
   message.textContent=denied
    ? 'Location access was denied or blocked. Check both your phone and browser permissions below, then try GPS again.'
    : unavailable
     ? 'Location requests are unavailable in this browser or connection. Open Attendigo in a secure browser and enable device Location Services.'
     : 'Select Allow location below, then select Allow or While Using the App if your browser asks.';
   proceed.textContent=denied||unavailable?'Try GPS again':'Allow location';
  }
  function open(state){
   render(state);
   if(!dialog.open)dialog.showModal();
   proceed.focus();
  }
  dialog.querySelector('#staffLocationPermissionCancel').addEventListener('click',()=>dialog.close());
  proceed.addEventListener('click',()=>{
   // A permission status can be stale or incomplete, especially in mobile browsers.
   // Always retry actual GPS on this user gesture; the browser still controls access.
   dialog.close();startCapture();
  });
  return open;
 }

 async function initHead(user){
  const card=$('staffLunchHeadLocationCard'),button=$('staffLunchHeadSubmit'),
   status=$('staffLunchHeadStatus'),title=$('staffLunchHeadDepartment');
  if(!card||!status||!button)return;
  card.hidden=false;
  const departmentId=user.departmentId;
  if(!departmentId){
   status.textContent='Your account has no assigned department. Contact the School Admin.';
   button.disabled=true;return;
  }
  title.textContent=user.departmentName||'My assigned department';
  async function refresh(){
   try{
    const [info,registry]=await Promise.all([request('/api/staff-attendance/lunch/location'),request('/api/staff-attendance/lunch/campuses')]);
    const campus=$('staffLunchHeadCampus');
    if(campus){campus.replaceChildren(new Option('Existing trusted department area (if configured)',''));for(const c of registry.campuses||[])campus.add(new Option(c.name,c.campusId));if(info.campusId){if(![...campus.options].some(o=>o.value===info.campusId))campus.add(new Option('Previously assigned campus (unavailable)',info.campusId));campus.value=info.campusId;campus.disabled=true;}}
    title.textContent=info.departmentName||title.textContent;
    const current=info.configured?'Attendance location is active.':'No active department location. Select an authorized campus, or use Gatekeeper scanning.';
    const radius=$('staffLunchHeadRadius');if(radius&&info.radiusMeters)radius.value=String(info.radiusMeters);
    status.textContent=current+(info.proposalStatus==='PENDING'?' Capture fresh GPS to replace the former pending proposal.':'');
   }catch(error){status.textContent='Unable to load department location: '+error.message;}
  }
  async function submitLocation(){
   if(button.disabled)return;
   button.disabled=true;
   status.textContent='Checking your position. Allow location access while physically inside your department.';
   try{
    if(!window.isSecureContext||!navigator.geolocation){
     status.textContent='Location not submitted: this browser does not support secure GPS access.';
     openGuide('unavailable');return;
    }
    if(navigator.onLine===false)throw Error('Reconnect to the internet before submitting your department location.');
    const position=await getPosition(quality=>{
      status.textContent='Collecting GPS readings: about '+quality.accuracyMeters+
       ' m reported accuracy ('+quality.sampleCount+' readings)…';
    });
    if(!Number.isFinite(position.accuracyMeters)||position.accuracyMeters>70||
       !Array.isArray(position.samples)||position.samples.length<2)
     throw Error('Not enough precise GPS readings to submit. Enable precise location, move near a window and retry.');
    status.textContent='GPS captured (about '+Math.round(position.accuracyMeters)+' m accuracy). Validating and activating…';
    const result=await request('/api/staff-attendance/lunch/location/propose',{
     method:'POST',
     body:JSON.stringify({departmentId,latitude:position.latitude,
      longitude:position.longitude,accuracyMeters:position.accuracyMeters,
      samples:position.samples,campusId:$('staffLunchHeadCampus')?.value||undefined,radiusMeters:Number($('staffLunchHeadRadius')?.value||120)})
    });
    if(result.status!=='ACTIVE')throw Error('The server did not confirm activation.');
    const saved=await request('/api/staff-attendance/lunch/location');
    if(!saved.configured||saved.departmentId!==departmentId)throw Error('Activation could not be confirmed. Refresh before retrying.');
    await refresh();
    status.textContent=result.message||'Department attendance location is active.';
   }catch(error){
    status.textContent='Location not submitted: '+failure(error);
    if(error?.code===1)openGuide('denied');
   }finally{button.disabled=false;}
  }
  const openGuide=buildLocationPermissionDialog(()=>{void submitLocation();});
  button.addEventListener('click',()=>{
   // Request on the original tap, even when a cached Permissions API state says denied.
   // A real denial opens the help dialog; never fabricate coordinates or bypass approval.
   void submitLocation();
  });
  document.addEventListener('attendigo:dashboard-refresh',event=>{if(!card.hidden&&!button.disabled)event.detail.tasks.push(refresh());});
  await refresh();
 }
 window.attendigoStaffIdentity?.then(user=>{
  if(user?.role==='DEPARTMENT_HEAD')return initHead(user);
  // The former School Admin approval interface is intentionally retired.
 }).catch(()=>{});
})();
