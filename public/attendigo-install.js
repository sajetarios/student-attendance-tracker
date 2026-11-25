(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else api.init(root);
})(typeof window==='object'?window:null,function(){
  'use strict';
  function platform(nav){
    const ua=nav.userAgent||'';
    if(/FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|TikTok|; wv\)/i.test(ua)) return 'embedded';
    if(/iPhone|iPad|iPod/i.test(ua)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1)) return 'ios';
    return /Android/i.test(ua)?'android':'other';
  }
  function installed(win){
    return win.navigator.standalone===true||['standalone','fullscreen','minimal-ui','window-controls-overlay'].some(mode=>win.matchMedia?.('(display-mode: '+mode+')')?.matches);
  }
  function init(win){
    const doc=win.document,nav=win.navigator;
    let deferred=null,completed=false,busy=false;
    const mode=platform(nav);
    const get=id=>doc.getElementById(id);
    function render(){
      const active=completed||installed(win);
      doc.querySelectorAll('[data-attendigo-install]').forEach(el=>{el.hidden=active;});
      if(!get('installAction'))return;
      const ready=!!deferred&&!active&&mode!=='embedded';
      get('installAction').hidden=!ready;
      get('installAction').disabled=busy;
      get('installDone').hidden=!active;
      for(const key of ['ios','android','other','embedded']){
        get('guide-'+key).hidden=active||mode!==key;
      }
      get('installCopy').hidden=active||mode!=='embedded';
    }
    function status(message){const el=get('installStatus');if(el)el.textContent=message;}
    async function prompt(){
      if(!deferred||busy||completed||installed(win))return;
      const event=deferred;deferred=null;busy=true;render();
      try{
        await event.prompt();
        const choice=await event.userChoice;
        status(choice?.outcome==='accepted'?'Installation accepted. Open Attendigo from your Home Screen or apps list when it is ready.':'Installation dismissed. You can still use the instructions below.');
      }catch(_){status('The installation prompt is unavailable. Follow the browser instructions below.');}
      finally{busy=false;render();}
    }
    win.addEventListener('beforeinstallprompt',event=>{
      event.preventDefault();deferred=event;render();
    });
    win.addEventListener('appinstalled',()=>{completed=true;deferred=null;status('Attendigo was installed.');render();});
    win.addEventListener('pageshow',render);
    win.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change',render);
    function mount(){
      doc.querySelectorAll('[data-attendigo-install]').forEach(link=>link.addEventListener('click',event=>{
        if(deferred&&!busy&&!completed&&!installed(win)&&mode!=='embedded'){event.preventDefault();void prompt();}
      }));
      get('installAction')?.addEventListener('click',()=>void prompt());
      const input=get('installUrl');
      if(input)input.value=win.location.origin+'/install.html';
      get('installCopy')?.addEventListener('click',async()=>{
        try{await nav.clipboard.writeText(input.value);status('Link copied. Paste it into Safari or Chrome.');}
        catch(_){input.focus();input.select();status('Select and copy the link, then open Safari or Chrome.');}
      });
      render();
      if(get('installAction')&&win.isSecureContext&&'serviceWorker' in nav){
        nav.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>status('Automatic installation may be unavailable. You can still continue in your browser.'));
      }
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
  return {platform,installed,init};
});
