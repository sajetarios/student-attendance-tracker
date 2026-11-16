/* Mobile smart header: keep navigation reachable without another floating action. */
(() => {
  'use strict';
  const bar=document.querySelector('.portal-page .topbar');
  if(!bar)return;
  const mq=window.matchMedia('(max-width: 860px)');
  let previous=window.scrollY||document.documentElement.scrollTop||0;
  let compact=false,frame=0,holdUntil=0;
  const drawerOpen=()=>document.body.classList.contains('sidebar-drawer-open');
  const overlayOpen=()=>Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden]), .modal.show, .modal.is-open'));
  const popupOpen=()=>Boolean(document.querySelector('#accountMenuButton[aria-expanded="true"], #adminNotificationBell[aria-expanded="true"]'));
  const protectedUI=()=>drawerOpen()||overlayOpen()||popupOpen()||bar.contains(document.activeElement);
  function setCompact(value){
    if(!mq.matches)value=false;
    if(compact===value)return;
    compact=value;
    document.body.classList.toggle('smart-header-compact',value);
    bar.dataset.smartHeader=value?'compact':'full';
  }
  function update(){
    frame=0;
    if(!mq.matches){setCompact(false);return}
    const y=Math.max(0,window.scrollY||document.documentElement.scrollTop||0);
    const delta=y-previous;
    if(protectedUI()){setCompact(false);previous=y;return}
    if(y<56){setCompact(false)}
    else if(Math.abs(delta)>=5){
      if(delta>0)setCompact(true);
      else setCompact(false);
    }
    previous=y;
  }
  window.addEventListener('scroll',()=>{
    if(!frame)frame=requestAnimationFrame(update);
  },{passive:true});
  window.addEventListener('resize',()=>{previous=window.scrollY||0;update()},{passive:true});
  mq.addEventListener?.('change',()=>{previous=window.scrollY||0;update()});
  bar.addEventListener('focusin',()=>setCompact(false));
  bar.addEventListener('focusout',()=>requestAnimationFrame(update));
  document.getElementById('sidebarToggle')?.addEventListener('click',()=>setCompact(false));
  document.addEventListener('click',event=>{
    if(event.target.closest('.topbar, .sidebar, [role="dialog"], dialog'))requestAnimationFrame(update);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')requestAnimationFrame(update);
  });
  update();
})();
