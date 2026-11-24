(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const panel=$('pushNotifications');
  if(!panel)return;
  const enable=$('pushEnable'),disable=$('pushDisable'),test=$('pushTest');
  const status=$('pushStatus'),help=$('pushInstructions'),steps=$('pushSetupSteps');
  const iosGuide=$('pushIosGuide'),link=$('pushCopyLink'),stateBadge=$('pushStateBadge');
  const OPT_IN='attendigo.parentPush.consent.v1';
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=()=>window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true;
  const supported=()=>('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  let config=null,working=false,opted=false;
  const setOptIn=value=>{
    opted=value;
    try {if(value)localStorage.setItem(OPT_IN,'yes');else localStorage.removeItem(OPT_IN);} catch {}
  };
  try{opted=localStorage.getItem(OPT_IN)==='yes'}catch{}
  function message(text,{error=false}={}){
    status.textContent=text;status.dataset.error=String(error);
  }
  function state(label){
    if(stateBadge)stateBadge.textContent=label;
  }
  function busy(value){
    working=value;
    for(const button of [enable,disable,test,link])if(button)button.disabled=value;
  }
  async function api(path,options={}){
    const response=await fetch(path,{
      credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json',...(options.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Phone notification setup could not be completed.');
    return data;
  }
  function keyBytes(base64url){
    const binary=atob(base64url.replace(/-/g,'+').replace(/_/g,'/')+
      '='.repeat((4-base64url.length%4)%4));
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  async function registration(){
    const existing=await navigator.serviceWorker.getRegistration('/');
    return existing||navigator.serviceWorker.register('/sw.js',{scope:'/'});
  }
  async function subscription(){
    const current=await navigator.serviceWorker.getRegistration('/');
    return current?.pushManager?.getSubscription()||null;
  }
  function stage(step){
    if(steps){
      steps.hidden=false;
      for(const item of steps.querySelectorAll('[data-push-step]')){
        const n=Number(item.dataset.pushStep);
        item.dataset.state=n<step?'complete':n===step?'current':'pending';
      }
    }
  }
  function controls({allow=false,active=false,install=false}={}){
    enable.hidden=!allow;
    disable.hidden=!active;
    test.hidden=!active;
    if(link)link.hidden=!install;
    if(iosGuide)iosGuide.hidden=!install;
    enable.disabled=working||!allow;
    disable.disabled=working||!active;
    test.disabled=working||!active;
  }
  async function registerExisting(current){
    if(!current)return false;
    await api('/api/parent/push/subscribe',{
      method:'POST',body:JSON.stringify({subscription:current.toJSON()})
    });
    return true;
  }
  async function refresh(){
    if(working)return;
    try{
      config=await api('/api/parent/push/config');
      if(!config.available){
        state('Unavailable');
        stage(1);controls();
        message('Phone notifications are not configured by your school. Your Attendigo notification bell still works.');
        return;
      }
      if(isIOS&&!installed()){
        state('One-time setup');
        stage(1);controls({install:true});
        help.hidden=false;
        help.textContent='For iPhone: open Attendigo in Safari, tap Share (the square with an arrow), choose Add to Home Screen, then open Attendigo from its new icon. You only do this once.';
        message('First, add Attendigo to your Home Screen to receive alerts even when Safari is closed.');
        return;
      }
      if(!supported()){
        state('Unavailable');stage(1);controls();
        help.hidden=false;help.textContent='Phone push is not supported in this browser. In-app notifications remain available.';
        message('This browser does not support phone notifications.');
        return;
      }
      help.hidden=true;
      // Register the existing service worker silently. This does not request
      // permission or create a new subscription without the parent's consent.
      await registration();
      if(Notification.permission==='denied'){
        state('Blocked');stage(2);controls();
        help.hidden=false;
        help.textContent='Notifications were blocked in your phone settings. Open Settings → Notifications → Attendigo, turn on Allow Notifications, then return to this page.';
        message('Your device has blocked notifications. Attendigo cannot override your phone’s choice.',{error:true});
        return;
      }
      const current=await subscription();
      if(current&&Notification.permission==='granted'&&opted){
        try{
          // Restore an existing consented subscription after app/login changes.
          // Server still enforces parent identity and approved-child scope.
          await registerExisting(current);
        }catch(error){
          state('Needs attention');stage(2);controls({allow:true});
          message('This phone needs to reconnect: '+error.message,{error:true});
          return;
        }
        state('Enabled');stage(3);controls({active:true});
        message('Phone notifications are enabled. Your parent alerts can arrive while Attendigo is closed.');
        return;
      }
      state('Not enabled');stage(2);controls({allow:true});
      if(Notification.permission==='granted'&&current){
        message('Your phone allows notifications. Tap “Activate phone alerts” once to finish linking this parent account.');
      }else{
        message('Tap “Activate phone alerts” once. Attendigo will set up this phone and send a test automatically.');
      }
    }catch(error){
      state('Needs attention');stage(2);controls({allow:true});
      message('Setup check failed: '+error.message,{error:true});
    }
  }
  async function sendTest(current){
    return api('/api/parent/push/test',{
      method:'POST',body:JSON.stringify({endpoint:current.endpoint})
    });
  }
  enable.addEventListener('click',async()=>{
    if(working)return;
    if(isIOS&&!installed()){await refresh();return;}
    if(!supported()){await refresh();return;}
    // Apple and browsers require a direct, user-initiated permission request.
    let permission;
    try{permission=Notification.permission==='granted'?'granted':await Notification.requestPermission()}
    catch{message('Unable to request permission. Try opening Attendigo from its Home Screen icon.',{error:true});return;}
    if(permission!=='granted'){
      message('Notifications were not allowed. You can change this later in your phone settings.',{error:true});
      await refresh();return;
    }
    busy(true);state('Setting up');
    try{
      if(!config?.publicKey)config=await api('/api/parent/push/config');
      if(!config.publicKey)throw Error('School notification configuration is unavailable.');
      const sw=await registration();
      let current=await sw.pushManager.getSubscription();
      const created=!current;
      if(!current)current=await sw.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)
      });
      try{
        await registerExisting(current);
      }catch(error){
        if(created)await current.unsubscribe().catch(()=>{});
        throw error;
      }
      setOptIn(true);
      state('Enabled');stage(3);controls({active:true});
      message('Phone notifications are enabled. Sending your first test…');
      try{
        await sendTest(current);
        message('Setup complete. Test sent to your phone! Check the Lock Screen or Notification Center. Future confirmed subject updates will be pushed automatically.');
      }catch(error){
        message('Phone setup succeeded, but the test could not be sent: '+error.message,{error:true});
      }
    }catch(error){
      state('Needs attention');stage(2);controls({allow:true});
      message('Setup could not finish: '+error.message,{error:true});
    }finally{
      busy(false);
      if(opted){controls({active:true});state('Enabled');}
    }
  });
  disable.addEventListener('click',async()=>{
    if(working)return;
    busy(true);
    try{
      const current=await subscription();
      if(current){
        await api('/api/parent/push/unsubscribe',{
          method:'POST',body:JSON.stringify({endpoint:current.endpoint})
        });
        await current.unsubscribe();
      }
      setOptIn(false);
      state('Disabled');stage(2);controls({allow:true});
      message('Phone notifications are off for this device. In-app alerts still work.');
    }catch(error){
      message('Could not disable phone notifications: '+error.message,{error:true});
    }finally{busy(false);await refresh();}
  });
  test.addEventListener('click',async()=>{
    if(working)return;
    busy(true);
    try{
      const current=await subscription();
      if(!current)throw Error('Activate phone notifications first.');
      await sendTest(current);
      message('The push service accepted your test. Check the Lock Screen or Notification Center.');
    }catch(error){
      message('Test failed: '+error.message,{error:true});
    }finally{busy(false);}
  });
  if(link)link.addEventListener('click',async()=>{
    try{
      await navigator.clipboard.writeText(location.origin+'/parent-portal.html');
      message('Attendigo link copied. Open Safari, paste it, and follow the Add to Home Screen steps.');
    }catch{message('Open this address in Safari: '+location.origin+'/parent-portal.html');}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!working)void refresh();});
  window.addEventListener('pageshow',()=>{if(!working)void refresh();});
  void refresh();
  if(location.hash.startsWith('#pushNotifications'))panel.scrollIntoView({block:'start'});
})();
