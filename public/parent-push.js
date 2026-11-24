(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const panel=$('pushNotifications');
  if(!panel)return;
  const enable=$('pushEnable'),disable=$('pushDisable'),test=$('pushTest');
  const status=$('pushStatus'),help=$('pushInstructions');
  let config=null,working=false;
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=()=>window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true;
  const supported=()=>('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  function display(message,{error=false}={}){
    status.textContent=message;status.dataset.error=String(error);
  }
  function loading(value){
    working=value;enable.disabled=value;disable.disabled=value;test.disabled=value;
  }
  async function api(path,options={}){
    const response=await fetch(path,{
      credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json',...(options.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Unable to update phone notifications.');
    return data;
  }
  function keyBytes(base64url){
    const binary=atob(base64url.replace(/-/g,'+').replace(/_/g,'/')+
      '='.repeat((4-base64url.length%4)%4));
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  async function currentSubscription(){
    const reg=await navigator.serviceWorker.getRegistration('/');
    if(!reg)return null;
    return reg.pushManager.getSubscription();
  }
  async function refresh(){
    try{
      config=await api('/api/parent/push/config');
      if(!config.available){display('Phone push is not configured by the school yet. In-app notifications still work.');help.hidden=false;enable.disabled=true;disable.hidden=true;test.hidden=true;return;}
      if(isIOS&&!installed()){
        help.hidden=false;
        help.textContent='On iPhone/iPad: open this site in Safari, tap Share → Add to Home Screen, then open Attendigo from the Home Screen before enabling notifications.';
        display('To receive iPhone notifications, install Attendigo on your Home Screen.');
        enable.disabled=true;disable.hidden=true;test.hidden=true;return;
      }
      if(!supported()){
        display('This browser does not support Web Push. Your Attendigo notification bell still works.');
        help.hidden=false;enable.disabled=true;disable.hidden=true;test.hidden=true;return;
      }
      help.hidden=true;
      const sub=await currentSubscription();
      const allowed=Notification.permission==='granted';
      enable.hidden=Boolean(sub&&allowed);disable.hidden=!(sub&&allowed);
      test.hidden=!(sub&&allowed);
      if(Notification.permission==='denied'){
        display('Notifications are blocked. Enable them in this device’s browser or app settings.',{error:true});
        enable.disabled=true;
      }else if(sub&&allowed){
        display('This device has a browser subscription. Use “Send test” to verify phone delivery.');
      }else{
        display('Phone alerts are off on this device. Tap Enable to receive attendance notifications.');
      }
    }catch(error){display(error.message,{error:true})}
  }
  enable.addEventListener('click',async()=>{
    if(working)return;
    if(isIOS&&!installed()){await refresh();return}
    if(!supported()){await refresh();return}
    // Permission MUST be requested from this direct user gesture (Apple/Web Push).
    let permission;
    try{permission=await Notification.requestPermission()}catch(error){display('Could not request notification permission.',{error:true});return}
    if(permission!=='granted'){display('Phone notifications were not allowed. You can enable them in device settings.',{error:true});return}
    loading(true);
    try{
      if(!config?.publicKey)config=await api('/api/parent/push/config');
      if(!config.publicKey)throw Error('School Web Push configuration is missing.');
      await navigator.serviceWorker.register('/sw.js',{scope:'/'});
      const registration=await navigator.serviceWorker.ready;
      let sub=await registration.pushManager.getSubscription();
      const isNew=!sub;
      if(!sub)sub=await registration.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)
      });
      try{
        await api('/api/parent/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})});
      }catch(error){
        if(isNew)await sub.unsubscribe().catch(()=>{});
        throw error;
      }
      display('Phone notifications enabled. Tap “Send test” to verify this device.');
    }catch(error){display(error.message,{error:true})}
    finally{loading(false);await refresh()}
  });
  disable.addEventListener('click',async()=>{
    if(working)return;loading(true);
    try{
      const sub=await currentSubscription();
      if(sub){
        await api('/api/parent/push/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
        await sub.unsubscribe();
      }
      display('Phone notifications disabled for this device.');
    }catch(error){display(error.message,{error:true})}
    finally{loading(false);await refresh()}
  });
  test.addEventListener('click',async()=>{
    if(working)return;loading(true);
    try{
      const sub=await currentSubscription();
      if(!sub)throw Error('Enable phone notifications first.');
      const result=await api('/api/parent/push/test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
      display(result.message||'Push service accepted the test. Check your phone notifications.');
    }catch(error){display(error.message,{error:true})}
    finally{loading(false);enable.disabled=false;disable.disabled=false;test.disabled=false;}
  });
  void refresh();
  if(location.hash.startsWith('#pushNotifications'))panel.scrollIntoView({block:'start'});
})();
