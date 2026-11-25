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
    return win.navigator.standalone===true||['standalone','minimal-ui','window-controls-overlay'].some(mode=>win.matchMedia?.('(display-mode: '+mode+')')?.matches);
  }
  function init(win){
    const doc=win.document,nav=win.navigator;
    let deferred=null,completed=false,busy=false,mounted=false;
    const mode=platform(nav);
    const get=id=>doc.getElementById(id);
    function render(){
      if(!mounted)return;
      const active=completed||installed(win);
      const ready=!!deferred&&!active&&mode!=='embedded'&&mode!=='ios';
      doc.querySelectorAll('[data-install-caption]').forEach(el=>{el.textContent=ready?'Tap to install on your device':mode==='ios'?'Add to your Home Screen':mode==='embedded'?'Open in your phone browser':'Install or see simple setup steps';});
      doc.querySelectorAll('[data-attendigo-install],[data-attendigo-install-container]').forEach(el=>{el.hidden=active;});
      if(!get('installAction'))return;
      get('installAction').hidden=!ready;
      get('installAction').disabled=busy;
      get('installDone').hidden=!active;
      for(const key of ['ios','android','other','embedded']){
        get('guide-'+key).hidden=active||ready||mode!==key;
      }
      get('installCopy').hidden=false;
    }
    function status(message){const el=get('installStatus');if(el)el.textContent=message;doc.querySelectorAll('[data-install-status]').forEach(node=>{node.textContent=message;node.hidden=!message;});}
    async function showInstallPrompt(){
      if(!deferred||busy||completed||installed(win)||mode==='ios'||mode==='embedded')return;
      const event=deferred;deferred=null;busy=true;render();
      try{
        await event.prompt();
        const choice=await event.userChoice;
        status(choice?.outcome==='accepted'?'Installation accepted. Open Attendigo from your Home Screen or apps list when it is ready.':'Installation dismissed. You can still use the instructions below.');
      }catch(_){status('Installation is unavailable right now. Tap Install Attendigo again for setup instructions.');}
      finally{busy=false;render();}
    }
    win.addEventListener('beforeinstallprompt',event=>{
      if(mode==='ios'||mode==='embedded'||completed||installed(win))return;
      event.preventDefault();deferred=event;render();
    });
    win.addEventListener('appinstalled',()=>{completed=true;deferred=null;status('Attendigo was installed.');render();});
    win.addEventListener('pageshow',render);
    win.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change',render);
    function mount(){
      mounted=true;
      doc.querySelectorAll('[data-attendigo-install]').forEach(link=>link.addEventListener('click',event=>{
        if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
        if(busy||completed||installed(win)){event.preventDefault();return;}
        if(deferred&&mode!=='embedded'&&mode!=='ios'){event.preventDefault();void showInstallPrompt();}
      }));
      get('installAction')?.addEventListener('click',()=>void showInstallPrompt());
      const input=get('installUrl');
      if(input)input.value=win.location.origin+'/install.html';
      get('installCopy')?.addEventListener('click',async()=>{
        try{await nav.clipboard.writeText(input.value);status('Link copied. Paste it into Safari or Chrome.');}
        catch(_){input.focus();input.select();status('Select and copy the link, then open Safari or Chrome.');}
      });
      render();
      if(win.isSecureContext&&nav.onLine!==false&&'serviceWorker' in nav){
        nav.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
      }
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
  return {platform,installed,init};
});
