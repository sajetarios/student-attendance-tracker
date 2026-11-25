(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else api.init(root);
})(typeof window==='object'?window:null,function(){
 'use strict';
 function mount(win,guide){
   const steps=Array.from(guide.querySelectorAll('[data-walk-step]'));
   const controls=guide.querySelector('.walk-controls'),play=guide.querySelector('[data-walk-play]'),prev=guide.querySelector('[data-walk-prev]'),next=guide.querySelector('[data-walk-next]'),count=guide.querySelector('[data-walk-count]');
   if(!steps.length||!controls||!play||!prev||!next||!count)return;
   let index=0,timer=null,playing=false;
   function render(){
     steps.forEach((step,i)=>{step.hidden=i!==index;});
     prev.disabled=index===0;next.disabled=index===steps.length-1;
     count.textContent=(index+1)+' / '+steps.length;
     play.textContent=playing?'Ⅱ Pause / Ihinto':index===steps.length-1?'↻ Replay / Ulitin':'▶ Watch walkthrough / Panoorin';
     guide.dataset.playing=String(playing);
   }
   function stop(){if(timer!==null)win.clearInterval(timer);timer=null;playing=false;render();}
   function move(delta){stop();index=Math.max(0,Math.min(steps.length-1,index+delta));render();}
   function start(){
     if(playing){stop();return;}
     index=0;playing=true;render();
     timer=win.setInterval(()=>{if(guide.closest('[hidden]')||guide.closest('dialog:not([open])')||win.document.hidden||index>=steps.length-1){stop();return;}index++;render();},4000);
   }
   play.addEventListener('click',start);prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
   win.document.addEventListener('visibilitychange',()=>{if(win.document.hidden)stop();});
   win.addEventListener('pagehide',stop);
   guide.closest('dialog')?.addEventListener('close',stop);
   controls.hidden=false;render();
 }
 function init(win){win.document.querySelectorAll('[data-install-walkthrough]').forEach(guide=>mount(win,guide));}
 return {mount,init};
});
