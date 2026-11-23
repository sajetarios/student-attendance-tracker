'use strict';
(()=>{
 function create(tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=String(value);return e;}
 async function init(){
  if(document.querySelector('[data-school-memo-banner]'))return;
  const host=document.querySelector('#schoolWorkspace')||document.querySelector('main');
  if(!host)return;
  try{
   const response=await fetch('/api/school-memos?limit=12',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)return;
   const payload=await response.json();
   const memos=Array.isArray(payload.memoranda)?payload.memoranda:[];
   const unread=memos.filter(m=>!m.acknowledgedAt);
   const strip=create('aside','attendigo-memo-banner');
   strip.dataset.schoolMemoBanner='true';
   strip.setAttribute('aria-label','School memoranda');
   const icon=create('span','attendigo-memo-icon','▤');icon.setAttribute('aria-hidden','true');
   const copy=create('div','attendigo-memo-copy');
   copy.append(create('strong',null,unread.length
     ?unread.length+' school '+(unread.length===1?'memo awaits':'memos await')+' acknowledgment'
     :'School Memoranda'));
   const latest=unread[0];
   copy.append(create('small',null,latest
    ?latest.title+' · Open and acknowledge after reading'
    :'Open current school announcements and official documents'));
   const link=create('a','attendigo-memo-link','View memoranda');
   link.href=latest?'/school-memos.html?id='+encodeURIComponent(latest.memoId):'/school-memos.html';
   strip.append(icon,copy,link);
   if(!unread.length)strip.classList.add('attendigo-memo-quiet');
   host.insertBefore(strip,host.firstChild);
  }catch(_){/* Do not interrupt account workflows when the memo service is unavailable. */}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});
 else void init();
})();
