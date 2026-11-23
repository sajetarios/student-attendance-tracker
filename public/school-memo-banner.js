'use strict';
/* Shared Attendigo school-memoranda workspace.
 * Same-page, school-scoped viewing on staff, principal, parent and student dashboards.
 * Nothing is stored locally or inserted as HTML from school records.
 */
(()=>{
 const documentId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const make=(tag,cls,value)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
 };
 const fmt=date=>{
  if(!date)return 'Date unavailable';
  const d=new Date(date);
  return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-PH',
   {timeZone:'Asia/Manila',dateStyle:'medium'}).format(d):'Date unavailable';
 };
 const state={open:false,loading:false,role:'',memoId:'',memos:[],ready:false};
 const previews=new Map();
 function clearPreviews(){
  for(const url of previews.values())URL.revokeObjectURL(url);
  previews.clear();
 }
 let strip,panel,host,opener,refreshCount=0;
 const find=(id)=>panel?.querySelector('[data-memo-id="'+id+'"]');
 const getHost=()=>document.querySelector('#schoolWorkspace')||document.querySelector('main');
 async function request(path,options={}){
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  if(r.status===401||r.status===428)throw Error('Please sign in to read school memoranda.');
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.error||'School memorandum service unavailable.');
  return body;
 }
 function currentList(){return state.memos.filter(x=>!x.acknowledgedAt);}
 function banner(){
  if(!strip)return;
  const unread=currentList();
  strip.replaceChildren();
  const emblem=make('span','attendigo-memo-icon','▤');
  emblem.setAttribute('aria-hidden','true');
  const info=make('div','attendigo-memo-copy');
  info.append(make('strong',null,unread.length
   ?unread.length+' school '+(unread.length===1?'memorandum needs':'memoranda need')+' acknowledgment'
   :'School Memoranda'));
  info.append(make('small',null,unread.length
   ?unread[0].title+' · Open to read and acknowledge'
   :'School notices and official documents in your workspace'));
  const button=make('button','attendigo-memo-link',state.open?'Close memoranda':'View memoranda');
  button.type='button';button.setAttribute('aria-expanded',String(state.open));
  button.setAttribute('aria-controls','attendigoSchoolMemoPanel');
  button.addEventListener('click',()=>{
   if(state.open)close();else void open();
  });
  strip.classList.toggle('attendigo-memo-quiet',!unread.length);
  strip.append(emblem,info,button);
 }
 function setStatus(message){
  const target=panel?.querySelector('.attendigo-memo-status');
  if(target)target.textContent=message||'';
 }
 function close(){
  if(!panel)return;
  state.open=false;panel.hidden=true;
  clearPreviews();
  panel.querySelector('.attendigo-memo-list')?.replaceChildren();
  if(opener?.isConnected)opener.focus();
  else strip?.querySelector('button')?.focus();
  banner();
 }
 function setActiveMemo(id){
  const card=find(id);
  if(!card)return;
  if(card.getAttribute('aria-expanded')==='false')card.querySelector('.attendigo-memo-preview-toggle')?.click();
  card.scrollIntoView({block:'nearest',behavior:'smooth'});
  card.querySelector('.attendigo-memo-preview-toggle')?.focus({preventScroll:true});
 }
 async function preview(card,memo){
  const existing=card.querySelector('.attendigo-memo-preview');
  if(existing){
   const uri=previews.get(existing);if(uri)URL.revokeObjectURL(uri);
   previews.delete(existing);existing.remove();return false;
  }
  const area=make('div','attendigo-memo-preview');
  const description=make('p',null,'Preview of the attached memorandum. Viewing does not mark it read.');
  const content=make('div','attendigo-memo-frame-loading','Loading secure attachment…');
  const download=make('a','attendigo-memo-download','Download attachment instead');
  const uri='/api/school-memos/'+encodeURIComponent(memo.memoId)+'/file';
  download.href=uri;download.setAttribute('download',memo.filename||'school-memorandum');
  area.append(description,content,download);card.append(area);
  try{
   const response=await fetch(uri,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Attachment unavailable for this account.');
   const kind=String(response.headers.get('content-type')||'').split(';')[0].trim();
   if(!['application/pdf','image/png','image/jpeg'].includes(kind))
    throw Error('Unsupported attachment format.');
   const bytes=await response.blob();
   if(!bytes.size||bytes.size>4194304)throw Error('Invalid attachment size.');
   if(!area.isConnected)return false;
   const blobUrl=URL.createObjectURL(new Blob([bytes],{type:kind}));
   previews.set(area,blobUrl);
   const viewer=kind==='application/pdf'?make('iframe','attendigo-memo-frame'):
     make('img','attendigo-memo-frame attendigo-memo-image');
   if(kind==='application/pdf'){
    viewer.title='Attachment: '+memo.title;
    viewer.setAttribute('loading','lazy');viewer.setAttribute('referrerpolicy','no-referrer');
   }else viewer.alt='Attached memorandum: '+memo.title;
   viewer.src=blobUrl;
   content.replaceWith(viewer);
   return true;
  }catch(e){
   if(area.isConnected)content.textContent=e.message+' You can download the file instead.';
   return true;
  }
 }
 async function markRead(memo,button){
  button.disabled=true;button.textContent='Recording…';
  try{
   await request('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/acknowledge',{method:'POST'});
   memo.acknowledgedAt=new Date().toISOString();
   button.textContent='Acknowledged';button.classList.add('attendigo-memo-is-read');
   cardState(button.closest('.attendigo-memo-record'),true);
   banner();updateCounters();
   setStatus('Your acknowledgment was recorded. It does not mean you approve this memorandum.');
  }catch(e){button.disabled=false;button.textContent='Mark as read';setStatus(e.message);}
 }
 function cardState(card,read){
  card?.classList.toggle('attendigo-memo-unread',!read);
 }
 async function receipts(memo,button,output){
  button.disabled=true;
  try{
   const data=await request('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/receipts');
   output.textContent=String(data.notifiedAccounts||0)+' inbox notifications · '+
    String(data.acknowledgedAccounts||0)+' explicit acknowledgments. Notifications do not prove reading.';
  }catch(e){output.textContent=e.message;}
  finally{button.disabled=false;}
 }
 async function archive(memo,button){
  if(!window.confirm('Archive this memorandum for all recipients? Existing audit history will remain.'))return;
  button.disabled=true;
  try{
   await request('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/archive',{method:'POST'});
   setStatus('Memorandum archived.');await load();
  }catch(e){button.disabled=false;setStatus(e.message);}
 }
 function card(memo){
  const record=make('article','attendigo-memo-record');
  record.dataset.memoId=memo.memoId;record.setAttribute('aria-expanded','false');
  cardState(record,Boolean(memo.acknowledgedAt));
  const head=make('div','attendigo-memo-record-header');
  const body=make('div','attendigo-memo-record-title');
  const title=make('h3',null,memo.title);
  const subtitle=make('small',null,fmt(memo.publishedAt)+' · '+(memo.publisher||'School leadership'));
  body.append(title,subtitle);
  const tag=make('span','attendigo-memo-category',String(memo.category||'GENERAL').replaceAll('_',' '));
  head.append(body,tag);record.append(head);
  if(memo.summary)record.append(make('p','attendigo-memo-summary',memo.summary));
  const details=make('div','attendigo-memo-record-meta');
  details.append(make('span',null,memo.audience==='ALL_USERS'?'All school users':'School personnel'));
  if(memo.effectiveDate){
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const period=memo.endDate?memo.effectiveDate+' to '+memo.endDate:memo.effectiveDate+' (no end date recorded)';
   const stateText=today<memo.effectiveDate?'Upcoming':memo.endDate&&today>memo.endDate?'Ended':'Active';
   details.append(make('span',null,'Effective '+period+' · '+stateText));
  }
  if(memo.dtrHours){
   const h=memo.dtrHours;
   details.append(make('span',null,'Temporary personnel DTR hours: '+
    h.AM_IN+'–'+h.AM_OUT+' / '+h.PM_IN+'–'+h.PM_OUT+
    ' (prescribed hours only; recorded punches unchanged)'));
  }else details.append(make('span',null,'Announcement only · No DTR changes'));
  details.append(make('span',null,'Attachment: '+(memo.filename||'Document')));
  record.append(details);
  const actions=make('div','attendigo-memo-actions');
  const view=make('button','attendigo-memo-preview-toggle','View attachment');
  view.type='button';view.setAttribute('aria-expanded','false');
  view.addEventListener('click',async()=>{
   if(view.disabled)return;
   view.disabled=true;
   const shown=await preview(record,memo);
   view.textContent=shown?'Hide attachment':'View attachment';
   view.setAttribute('aria-expanded',String(shown));record.setAttribute('aria-expanded',String(shown));
   view.disabled=false;
  });
  actions.append(view);
  const ack=make('button','attendigo-memo-ack',memo.acknowledgedAt?'Acknowledged':'Mark as read');
  ack.type='button';ack.disabled=Boolean(memo.acknowledgedAt);
  ack.addEventListener('click',()=>void markRead(memo,ack));
  actions.append(ack);
  if(state.role==='PRINCIPAL'){
   const show=make('button','attendigo-memo-secondary','Read receipts');show.type='button';
   const report=make('p','attendigo-memo-receipts');
   show.addEventListener('click',()=>void receipts(memo,show,report));
   actions.append(show);
   const remove=make('button','attendigo-memo-secondary','Archive');remove.type='button';
   remove.addEventListener('click',()=>void archive(memo,remove));actions.append(remove);
   record.append(actions,report);
  }else record.append(actions);
  return record;
 }
 function updateCounters(){
  const all=panel?.querySelector('[data-memo-count="published"]');
  const unread=panel?.querySelector('[data-memo-count="unread"]');
  if(all)all.textContent=String(state.memos.length);
  if(unread)unread.textContent=String(currentList().length);
 }
 function render(){
  const list=panel.querySelector('.attendigo-memo-list');
  clearPreviews();list.replaceChildren();
  updateCounters();
  if(!state.memos.length){
   const empty=make('div','attendigo-memo-empty');
   const icon=make('span','attendigo-memo-empty-icon','▤');icon.setAttribute('aria-hidden','true');
   empty.append(icon,make('strong',null,'No memoranda published yet'),
    make('p',null,'Official school announcements and attached documents will appear here when shared with your account.'));
   list.append(empty);
  }else{
   for(const item of state.memos)list.append(card(item));
  }
  banner();
  if(documentId.test(state.memoId))setActiveMemo(state.memoId);
 }
 async function load(){
  if(state.loading)return;
  state.loading=true;setStatus('Loading school memoranda…');
  try{
   const result=await request('/api/school-memos?limit=50');
   state.memos=Array.isArray(result.memoranda)?result.memoranda:[];
   render();
   setStatus(state.memos.length?'Read official memos below. Acknowledgment is always a separate action.':'No memoranda are currently published to your audience.');
  }catch(e){setStatus(e.message);}
  finally{state.loading=false;}
 }
 function build(){
  host=getHost();if(!host)return false;
  if(strip&&panel){
   if(!strip.isConnected||!panel.isConnected){
    host.insertBefore(panel,host.firstChild);
    host.insertBefore(strip,panel);
   }
   return true;
  }
  strip=make('aside','attendigo-memo-banner');strip.dataset.schoolMemoBanner='true';
  strip.setAttribute('aria-label','School memoranda');
  panel=make('section','attendigo-memo-workspace');
  panel.id='attendigoSchoolMemoPanel';panel.hidden=true;
  panel.setAttribute('aria-labelledby','attendigoMemoTitle');
  const heading=make('div','attendigo-memo-workspace-head');
  const copy=make('div','attendigo-memo-workspace-intro');
  copy.append(make('span','attendigo-memo-eyebrow','ATTENDIGO · SCHOOL COMMUNICATIONS'));
  const title=make('h2',null,'School Memoranda');title.id='attendigoMemoTitle';
  title.tabIndex=-1;
  copy.append(title,make('p',null,'Official school announcements and supporting documents, right inside your workspace.'));
  const dismiss=make('button','attendigo-memo-close','Close');dismiss.type='button';
  dismiss.setAttribute('aria-label','Close School Memoranda');
  dismiss.addEventListener('click',close);
  heading.append(copy,dismiss);
  const counters=make('div','attendigo-memo-counters');
  for(const [type,label] of [['published','Published'],['unread','Awaiting acknowledgment']]){
   const pill=make('span','attendigo-memo-counter');
   const number=make('strong',null,'0');number.dataset.memoCount=type;
   pill.append(number,make('span',null,label));counters.append(pill);
  }
  const toolbar=make('div','attendigo-memo-toolbar');
  const reload=make('button','attendigo-memo-refresh','Refresh');reload.type='button';
  reload.addEventListener('click',()=>void load());
  toolbar.append(counters,reload);
  const status=make('p','attendigo-memo-status','');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const list=make('div','attendigo-memo-list');
  const footer=make('p','attendigo-memo-footnote',
   'Marking a memo as read is not an approval. A memorandum does not by itself alter DTR, leave, attendance or class schedules.');
  panel.append(heading,toolbar,status,list,footer);
  // Inline adjacent to the school notice, inside each user's existing dashboard.
  host.insertBefore(panel,host.firstChild);
  host.insertBefore(strip,panel);
  banner();return true;
 }
 async function open(id){
  if(!build()&&!panel)return false;
  opener=document.activeElement;
  if(documentId.test(String(id||'')))state.memoId=String(id);
  else state.memoId='';
  state.open=true;panel.hidden=false;banner();
  await load();
  panel.scrollIntoView({block:'start',behavior:'smooth'});
  if(!state.memoId)panel.querySelector('#attendigoMemoTitle')?.focus({preventScroll:true});
  return true;
 }
 function selectRole(){
  // Principal-only actions are additionally protected server-side.
  fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'})
   .then(r=>r.ok?r.json():null).then(d=>{
    state.role=d?.user?.role||'';
    if(state.open)render();
   }).catch(()=>{});
 }
 function intercept(e){
  const trigger=e.target.closest('a[href],button[data-school-memo-open]');
  if(!trigger)return;
  if(trigger.matches('[data-school-memo-open]')){
   e.preventDefault();void open(trigger.dataset.memoId||'');return;
  }
  if(trigger.tagName!=='A')return;
  const href=trigger.getAttribute('href')||'';
  if(!href.startsWith('/school-memos.html'))return;
  e.preventDefault();
  const url=new URL(href,location.origin);
  void open(url.searchParams.get('id')||'');
 }
 function ready(){
  if(state.ready)return;state.ready=true;
  build();selectRole();
  // Listen to clicks in the same dashboard, including legacy links.
  document.addEventListener('click',intercept);
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&state.open)close();
  });
  document.addEventListener('visibilitychange',()=>{
   if(!document.hidden)void refresh();
  });
  window.setInterval(()=>{if(!document.hidden)void refresh();},120000);
  const id=new URLSearchParams(location.search).get('memo');
  if(documentId.test(String(id||'')))void open(id);
  else void refresh();
 }
 async function refresh(){
  if(!build())return;
  if(state.open){await load();return;}
  try{
   const payload=await request('/api/school-memos?limit=50');
   state.memos=Array.isArray(payload.memoranda)?payload.memoranda:[];
   banner();
  }catch(_){/* An unavailable memo feed must not interrupt dashboard operations. */}
 }
 window.AttendigoSchoolMemos={open,refresh};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});
 else ready();
})();
