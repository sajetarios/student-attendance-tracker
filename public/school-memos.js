'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const formatDate=v=>v?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Date unavailable';
 const cleanId=v=>/^[0-9a-f-]{36}$/i.test(v)?v:'';
 function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;}
 async function api(url,options={}){
  const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.replace('/portal-login.html');throw Error('Please sign in to read school memoranda.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Request failed ('+response.status+').');
  return data;
 }
 async function acknowledge(memo,button){
  if(button.disabled)return;
  button.disabled=true;button.textContent='Recording acknowledgment…';
  try{
   await api('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/acknowledge',{method:'POST'});
   button.textContent='Acknowledged';button.classList.add('is-acknowledged');
   const card=button.closest('.memo-card');
   card?.classList.remove('memo-unread');
   $('memoSummary').textContent='Acknowledgment recorded. This confirms only that you marked the memo as read.';
  }catch(e){button.disabled=false;button.textContent='Mark as read';$('memoSummary').textContent=e.message;}
 }
 async function showReceipts(memo,button){
  button.disabled=true;
  try{
   const data=await api('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/receipts');
   const target=button.closest('.memo-card').querySelector('.memo-receipts');
   target.textContent=String(data.notifiedAccounts||0)+' in-app inboxes notified · '+
     String(data.acknowledgedAccounts||0)+' explicit read acknowledgments. Notification delivery is not proof the memo was viewed.';
  }catch(e){$('memoSummary').textContent=e.message;}
  finally{button.disabled=false;}
 }
 async function archive(memo,button){
  if(!window.confirm('Archive this memorandum? It will no longer be available to school users, but the audit record will be retained.'))return;
  button.disabled=true;
  try{
   await api('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/archive',{method:'POST'});
   await load();
  }catch(e){button.disabled=false;$('memoSummary').textContent=e.message;}
 }
 function renderMemo(memo,principal){
  const card=el('article','memo-card'+(memo.acknowledgedAt?'':' memo-unread'));
  card.id='memo-'+memo.memoId;
  const head=el('div','memo-card-heading');
  const title=el('div','memo-card-title');
  title.append(el('h2',null,memo.title),el('small',null,formatDate(memo.publishedAt)+' · '+(memo.publisher||'School administration')));
  const tag=el('span','memo-tag',String(memo.category||'GENERAL').replaceAll('_',' '));
  head.append(title,tag);card.append(head);
  if(memo.summary)card.append(el('p','memo-description',memo.summary));
  const info=el('div','memo-details');
  info.append(el('span',null,memo.audience==='ALL_USERS'?'All school users':'School personnel'));
  if(memo.effectiveDate)info.append(el('span',null,'Effective: '+memo.effectiveDate));
  info.append(el('span',null,'Attachment: '+(memo.filename||'Document')));
  card.append(info);
  const actions=el('div','memo-actions');
  const attachment=el('a','memo-view','Open attached memorandum');
  attachment.href='/api/school-memos/'+encodeURIComponent(memo.memoId)+'/file';
  attachment.target='_blank';attachment.rel='noopener noreferrer';
  actions.append(attachment);
  const ack=el('button',memo.acknowledgedAt?'memo-acknowledged':'memo-read',memo.acknowledgedAt?'Acknowledged':'Mark as read');
  ack.type='button';ack.disabled=Boolean(memo.acknowledgedAt);
  ack.addEventListener('click',()=>void acknowledge(memo,ack));actions.append(ack);
  if(principal){
   const receipts=el('button','memo-meta-action','Read receipts');
   receipts.type='button';receipts.addEventListener('click',()=>void showReceipts(memo,receipts));actions.append(receipts);
   const remove=el('button','memo-meta-action memo-archive','Archive');
   remove.type='button';remove.addEventListener('click',()=>void archive(memo,remove));actions.append(remove);
  }
  card.append(actions);
  if(principal)card.append(el('p','memo-receipts'));
  return card;
 }
 let principal=false;
 async function load(){
  $('memoSummary').textContent='Loading memoranda…';
  $('memoList').replaceChildren();
  try{
   const data=await api('/api/school-memos?limit=50');
   const memos=Array.isArray(data.memoranda)?data.memoranda:[];
   $('memoSummary').textContent=memos.length+' published '+(memos.length===1?'memorandum':'memoranda')+
     ' · '+(memos.filter(m=>!m.acknowledgedAt).length)+' not yet acknowledged in this list';
   for(const m of memos)$('memoList').append(renderMemo(m,principal));
   if(!memos.length)$('memoList').append(el('p','memo-empty','No memoranda are currently published to your audience.'));
   const anchor=cleanId(new URLSearchParams(location.search).get('id'));
   if(anchor){const target=$('memo-'+anchor);if(target)target.scrollIntoView({block:'center'});}
  }catch(e){$('memoSummary').textContent=e.message;}
 }
 async function init(){
  $('memoRefresh').addEventListener('click',()=>void load());
  try{
   const data=await api('/api/auth/me'),role=data.user?.role;
   principal=role==='PRINCIPAL';
   $('memoBack').href=role==='PRINCIPAL'?'/principal.html':role==='STUDENT'?'/student-portal.html':
    role==='PARENT'?'/parent-portal.html':'/portal.html';
  }catch(e){if(e.message&&!e.message.includes('sign in'))$('memoSummary').textContent=e.message;}
  await load();
 }
 void init();
})();