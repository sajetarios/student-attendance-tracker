'use strict';
/* User-controlled appearance setting shared by every school dashboard role. */
(function(){
  const key='attendance-dashboard-appearance';
  const allowed=['light','dark','system'];
  const root=document.documentElement;
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  function stored(){try{const value=localStorage.getItem(key);return allowed.includes(value)?value:'light';}catch{return 'light';}}
  let choice=stored();
  const themeButton=()=>document.getElementById('dashboardThemeToggle');
  function resolve(){return choice==='system'?(media?.matches?'dark':'light'):choice;}
  function repaint(){
    const current=resolve();
    root.dataset.uiTheme=current;
    root.style.colorScheme=current;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=current==='dark'?'#0b1222':'#f4f6fc';
    const button=themeButton();
    if(button){
      button.setAttribute('aria-label',current==='dark'?'Switch to light appearance':'Switch to dark appearance');
      button.setAttribute('title',current==='dark'?'Switch to light mode':'Switch to dark mode');
      button.setAttribute('aria-pressed',String(current==='dark'));
      button.innerHTML='<span class="theme-icon" aria-hidden="true">'+(current==='dark'?'☀':'☾')+'</span>';
    }
    document.querySelectorAll('[data-dashboard-theme]').forEach(item=>{
      item.setAttribute('aria-pressed',String(item.dataset.dashboardTheme===choice));
    });
  }
  function select(value){
    if(!allowed.includes(value))return;
    choice=value;try{localStorage.setItem(key,choice)}catch{}
    repaint();
    document.dispatchEvent(new CustomEvent('dashboard-theme-change',{detail:{theme:resolve(),preference:choice}}));
  }
  function init(){
    const right=document.querySelector('.topbar-right');
    const account=document.querySelector('#accountDropdown');
    if(right&&!themeButton()){
      const button=document.createElement('button');
      button.type='button';button.id='dashboardThemeToggle';
      button.className='ui-theme-toggle';
      right.insertBefore(button,right.firstChild);
      button.addEventListener('click',()=>{
        select(resolve()==='dark'?'light':'dark');
      });
    }
    if(account&&!account.querySelector('.ui-theme-control')){
      const control=document.createElement('div');control.className='ui-theme-control';
      control.setAttribute('role','group');control.setAttribute('aria-label','Appearance settings');
      control.innerHTML='<span>Appearance</span><div class="ui-theme-options">'+
        [['system','Automatic'],['light','Light'],['dark','Dark']].map(([value,label])=>
        '<button type="button" data-dashboard-theme="'+value+'" aria-pressed="false">'+label+'</button>').join('')+
        '</div>';
      const firstSignOut=account.querySelector('.signout');
      account.insertBefore(control,firstSignOut||null);
      control.addEventListener('click',event=>{
        const item=event.target.closest('[data-dashboard-theme]');
        if(item)select(item.dataset.dashboardTheme);
      });
    }
    repaint();
  }
  repaint();
  media?.addEventListener?.('change',()=>{if(choice==='system')repaint()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.DashboardAppearance={get:()=>resolve(),select};
})();
