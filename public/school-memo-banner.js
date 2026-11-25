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
 let view='home',repositoryRows=[],selectedMemo=null,offset=0,hasMore=false,repoSequence=0,repoTimer;
 let repositoryTools,repositoryNav,back,allButton,statusFilter,sortFilter;
 function clearPreviews(){
  for(const url of previews.values())URL.revokeObjectURL(url);
  previews.clear();
 }
 let strip,panel,host,opener,manager,managerSearch;
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
  const principal=state.role==='PRINCIPAL';
  strip.hidden=state.open||state.role==='SUPER_ADMIN';
  strip.replaceChildren();
  strip.classList.add('attendigo-memo-compact','attendigo-memo-launcher-shell');
  const emblem=make('span','attendigo-memo-icon');
  emblem.setAttribute('aria-hidden','true');
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.7');
  svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d','M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7z M13 3v7h7 M8 14h8 M8 17h6');
  svg.append(path);emblem.replaceChildren(svg);
  const info=make('span','attendigo-memo-copy');
  const heading=make('span','attendigo-memo-heading');
  heading.append(make('strong',null,'School Memoranda'));
  if(unread.length){
   const count=make('span','attendigo-memo-unread-count',unread.length+' unread');
   count.setAttribute('aria-label',unread.length+' memoranda awaiting acknowledgment');
   count.title='Unread memoranda in the latest available notices';
   heading.append(count);
  }
  info.append(heading);
  info.append(make('small',null,unread.length
   ?'New school notices require acknowledgment.'
   :principal?'Publish and manage official school notices.':'Read official school announcements and notices.'));
  const button=make('button','attendigo-memo-launcher');
  const action=make('span','attendigo-memo-launcher-action',principal?'Manage memoranda':unread.length?'Read memoranda':'View memoranda');
  const arrow=make('span','attendigo-memo-launcher-arrow','›');
  arrow.setAttribute('aria-hidden','true');
  info.append(action);
  button.append(emblem,info,arrow);
  button.type='button';button.setAttribute('aria-expanded',String(state.open));
  button.setAttribute('aria-controls','attendigoSchoolMemoPanel');
  button.addEventListener('click',()=>{
   if(state.open)close();else void open();
  });
  strip.classList.toggle('attendigo-memo-quiet',!unread.length);
  strip.append(button);
 }
 function setStatus(message){
  const target=panel?.querySelector('.attendigo-memo-status');
  if(target)target.textContent=message||'';
 }
 function close(){
  if(!panel)return;
  state.open=false;panel.hidden=true;repoSequence++;clearTimeout(repoTimer);
  if(panel.open&&typeof panel.close==='function')panel.close();
  view='home';state.memoId='';selectedMemo=null;
  clearPreviews();
  panel.querySelector('.attendigo-memo-list')?.replaceChildren();
  banner();
  if(opener?.isConnected&&!opener.closest('[hidden]'))opener.focus();
  else strip?.querySelector('button')?.focus();
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
 function acknowledgmentStatus(at){
  const date=new Date(at);
  const stamp=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-PH',
   {timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(date):'';
  const status=make('span','attendigo-memo-is-read','Acknowledged'+(stamp?' · '+stamp:''));
  status.setAttribute('role','status');return status;
 }
 async function markRead(memo,button){
  if(button.disabled||memo.acknowledgedAt)return;
  button.disabled=true;button.textContent='Recording acknowledgment…';
  try{
   const receipt=await request('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/acknowledge',{method:'POST'});
   if(receipt.acknowledged!==true||!receipt.acknowledgedAt||!Number.isFinite(Date.parse(receipt.acknowledgedAt)))
    throw Error('Could not verify your acknowledgment. Refresh the list and try again if needed.');
   memo.acknowledgedAt=receipt.acknowledgedAt;
   for(const item of state.memos)if(item.memoId===memo.memoId)item.acknowledgedAt=receipt.acknowledgedAt;
   const record=find(memo.memoId)||button.closest('.attendigo-memo-record');
   record?.querySelector('.attendigo-memo-ack')?.replaceWith(acknowledgmentStatus(receipt.acknowledgedAt));
   cardState(record,true);
   banner();updateCounters();
   setStatus('Your acknowledgment was recorded. It does not mean you approve this memorandum.');
  }catch(e){button.disabled=false;button.textContent='Acknowledge memorandum';setStatus(e.message);}
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
  const message=memo.dtrHours?
   'Archive this temporary DTR schedule memorandum? The prescribed-hour exception will stop for today and future dates, while earlier applicable DTR days and the audit history remain preserved.':
   'Archive this memorandum for all recipients? Existing audit history will remain.';
  if(button.disabled)return;
  button.disabled=true;
  if(!await window.AppDialog.confirm(message,{title:'Archive memorandum',confirmText:'Archive',variant:'danger'})){button.disabled=false;return;}
  try{
   await request('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/archive',{method:'POST'});
   selectedMemo=null;state.memoId='';view='repository';await load();setStatus('Memorandum archived.');
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
  if(memo.archivedAt)details.append(make('span',null,'Archived · '+fmt(memo.archivedAt)));
  if(memo.effectiveDate){
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
   const today=parts.year+'-'+parts.month+'-'+parts.day;
   const period=memo.endDate?memo.effectiveDate+' to '+memo.endDate:memo.effectiveDate+' (no end date recorded)';
   const stateText=memo.archivedAt?'Archived':today<memo.effectiveDate?'Upcoming':memo.endDate&&today>memo.endDate?'Ended':'Active';
   details.append(make('span',null,'Effective '+period+' · '+stateText));
  }
  if(memo.dtrHours){
   const h=memo.dtrHours;
   details.append(make('span',null,'Temporary personnel DTR hours: '+
    h.AM_IN+'–'+h.AM_OUT+' / '+h.PM_IN+'–'+h.PM_OUT+
    ' (prescribed hours only; recorded punches unchanged)'));
  }else if(memo.classPeriodMinutes)details.append(make('span',null,'Teaching periods: '+memo.classPeriodMinutes.original+' → '+memo.classPeriodMinutes.adjusted+' minutes · No DTR changes'));
  else details.append(make('span',null,'Announcement only · No DTR changes'));
  details.append(make('span',null,memo.filename?'Attachment: '+memo.filename:'No attachment'));
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
  if(memo.filename)actions.append(view);
  if(memo.archivedAt){if(memo.acknowledgedAt)actions.append(acknowledgmentStatus(memo.acknowledgedAt));}
  else if(memo.acknowledgedAt)actions.append(acknowledgmentStatus(memo.acknowledgedAt));
  else{
   const ack=make('button','attendigo-memo-ack','Acknowledge memorandum');
   ack.type='button';ack.addEventListener('click',()=>void markRead(memo,ack));
   actions.append(ack);
  }
  if(state.role==='PRINCIPAL'){
   const show=make('button','attendigo-memo-secondary','Read receipts');show.type='button';
   const report=make('p','attendigo-memo-receipts');
   show.addEventListener('click',()=>void receipts(memo,show,report));
   actions.append(show);
   const remove=make('button','attendigo-memo-secondary','Archive');remove.type='button';
   remove.addEventListener('click',()=>void archive(memo,remove));if(!memo.archivedAt)actions.append(remove);
   record.append(actions,report);
  }else record.append(actions);
  return record;
 }
 function syncManager(){
  if(state.role!=='PRINCIPAL'||!panel||manager)return;
  const publisher=document.getElementById('principalMemoPublishPanel');
  if(!publisher)return;
  panel.classList.add('attendigo-memo-management');
  const intro=panel.querySelector('.attendigo-memo-workspace-intro>p');
  intro.textContent='Publish official notices, review acknowledgments and archive memoranda from one workspace.';
  const toolbar=panel.querySelector('.attendigo-memo-toolbar');
  const actions=make('div','attendigo-memo-manager-actions');
  const create=make('button','attendigo-memo-create','+ Create memorandum');
  create.type='button';create.setAttribute('aria-expanded','false');
  create.setAttribute('aria-controls','attendigoMemoComposer');
  manager=make('div','attendigo-memo-composer');manager.id='attendigoMemoComposer';manager.hidden=true;
  // Reuse the authenticated Principal form and its existing submit handler.
  // Moving the original node preserves validation, selected files and listeners.
  publisher.classList.add('attendigo-memo-embedded-publisher');
  manager.append(publisher);
  toolbar.after(manager);
  create.addEventListener('click',()=>{view='create';render();publisher.querySelector('input[name="title"]')?.focus();});
  actions.append(create,toolbar.querySelector('.attendigo-memo-refresh'));
  toolbar.append(actions);
  ensureArchiveFilter();
  const label=panel.querySelector('[data-memo-count="unread"]')?.nextElementSibling;
  if(label)label.textContent='Recent unacknowledged';
 }
 function updateCounters(){
  const all=panel?.querySelector('[data-memo-count="published"]');
  const unread=panel?.querySelector('[data-memo-count="unread"]');
  const acknowledged=panel?.querySelector('[data-memo-count="acknowledged"]');
  const pending=currentList().length;
  if(all)all.textContent=String(state.memos.length);
  if(acknowledged)acknowledged.textContent=String(state.memos.length-pending);
  if(unread)unread.textContent=String(pending);
 }
 function statusOf(memo){
  if(memo.archivedAt)return 'Archived';
  if(!memo.effectiveDate)return 'Published';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  return today<memo.effectiveDate?'Upcoming':memo.endDate&&today>memo.endDate?'Past':'Active';
 }
 function ensureArchiveFilter(){
  if(state.role==='PRINCIPAL'&&!statusFilter?.querySelector('option[value="archived"]')){
   const option=make('option',null,'Archived');option.value='archived';statusFilter?.append(option);
  }
 }
 function repositoryRow(memo){
  const button=make('button','attendigo-memo-repository-row');
  button.type='button';
  const copy=make('span','attendigo-memo-row-copy');
  copy.append(make('strong',null,memo.title),make('small',null,fmt(memo.publishedAt)+' · '+String(memo.category||'GENERAL').replaceAll('_',' ')));
  const meta=make('span','attendigo-memo-row-meta');
  meta.append(make('span',null,statusOf(memo)),make('small',null,memo.archivedAt?'Archived':memo.acknowledgedAt?'Acknowledged':'Unread'));
  button.append(copy,meta,make('span','attendigo-memo-row-arrow','›'));
  button.addEventListener('click',()=>{selectedMemo=memo;state.memoId=memo.memoId;view='detail';render();panel.querySelector('#attendigoMemoTitle')?.focus();});
  return button;
 }
 function render(){
  const list=panel.querySelector('.attendigo-memo-list');
  clearPreviews();list.replaceChildren();updateCounters();
  const home=view==='home',repo=view==='repository',detail=view==='detail',creating=view==='create';
  panel.querySelector('#attendigoMemoTitle').textContent=home?(state.role==='PRINCIPAL'?'Manage Memoranda':'School Memoranda'):repo?'View All Memoranda':detail?'Memorandum details':'Create memorandum';
  back.hidden=home;allButton.hidden=!home;repositoryTools.hidden=!repo;repositoryNav.hidden=!repo;
  const create=panel.querySelector('.attendigo-memo-create');if(create){create.hidden=!home;create.setAttribute('aria-expanded',String(creating));}
  if(manager)manager.hidden=!creating;
  list.hidden=creating;
  if(creating){banner();return;}
  if(home){
   if(state.memos.length){list.append(make('h3','attendigo-memo-section-title','Latest memorandum'),card(state.memos[0]));}
   else list.append(make('p','attendigo-memo-empty','No memoranda published to your audience yet.'));
  }else if(detail){
   if(selectedMemo)list.append(card(selectedMemo));
   else list.append(make('p','attendigo-memo-empty','This memorandum is unavailable.'));
  }else{
   if(repositoryRows.length)for(const item of repositoryRows)list.append(repositoryRow(item));
   else list.append(make('p','attendigo-memo-empty','No matching memoranda.'));
   repositoryNav.querySelector('[data-memo-page="previous"]').disabled=offset===0;
   repositoryNav.querySelector('[data-memo-page="next"]').disabled=!hasMore;
   repositoryNav.querySelector('span').textContent='Page '+(Math.floor(offset/15)+1);
  }
  banner();
 }
 async function loadRepository(){
  const seq=++repoSequence;
  setStatus('Loading memorandum history…');
  const params=new URLSearchParams({repository:'1',limit:'15',offset:String(offset),q:managerSearch.value.trim(),status:statusFilter.value,sort:sortFilter.value});
  try{
   const data=await request('/api/school-memos?'+params);
   if(seq!==repoSequence||view!=='repository'||!state.open)return;
   repositoryRows=Array.isArray(data.memoranda)?data.memoranda:[];hasMore=Boolean(data.hasMore);
   render();setStatus('Search and filter all memoranda available to your account.');
  }catch(e){if(seq===repoSequence)setStatus(e.message);}
 }
 async function loadDetail(id){
  const seq=++repoSequence;
  try{
   const data=await request('/api/school-memos?repository=1&id='+encodeURIComponent(id)+'&limit=1');
   if(seq!==repoSequence||view!=='detail'||!state.open)return;
   selectedMemo=data.memoranda?.[0]||null;render();
  }catch(e){if(seq===repoSequence)setStatus(e.message);}
 }
 function openRepository(reset=false){
  if(reset){offset=0;managerSearch.value='';statusFilter.value='all';sortFilter.value='newest';repositoryRows=[];hasMore=false;}
  state.memoId='';selectedMemo=null;view='repository';render();void loadRepository();
 }
 function goBack(){
  repoSequence++;clearTimeout(repoTimer);
  if(view==='detail'){openRepository();return;}
  state.memoId='';selectedMemo=null;view='home';render();setStatus('');
 }
 async function load(){
  if(state.loading)return;
  state.loading=true;setStatus('Loading school memoranda…');
  try{
   const result=await request('/api/school-memos?limit=50');
   state.memos=Array.isArray(result.memoranda)?result.memoranda:[];
   render();
   if(view==='repository')await loadRepository();
   else if(view==='detail'&&state.memoId)await loadDetail(state.memoId);
   else setStatus('Acknowledgment confirms receipt, not approval.');
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
  panel=make('dialog','attendigo-memo-workspace');
  panel.id='attendigoSchoolMemoPanel';panel.hidden=true;
  panel.setAttribute('aria-labelledby','attendigoMemoTitle');
  panel.addEventListener('cancel',e=>{e.preventDefault();if(view!=='home')goBack();else close();});
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
  for(const [type,label] of [['published','Recent notices'],['acknowledged','Recent acknowledged'],['unread','Recent unacknowledged']]){
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
   'Acknowledgment confirms receipt only, not approval. Any authorized schedule directive takes effect independently of acknowledgment.');
  back=make('button','attendigo-memo-refresh attendigo-memo-back','‹ Back');back.type='button';back.hidden=true;back.addEventListener('click',goBack);
  repositoryTools=make('div','attendigo-memo-repository-tools');repositoryTools.hidden=true;
  const filter=make('label','attendigo-memo-search','Search memoranda');
  managerSearch=make('input','attendigo-memo-search-input');managerSearch.type='search';managerSearch.placeholder='Search title, content, category or date';
  managerSearch.addEventListener('input',()=>{offset=0;repoSequence++;clearTimeout(repoTimer);repoTimer=setTimeout(loadRepository,250);});
  filter.append(managerSearch);
  const select=(label,values)=>{const wrap=make('label','attendigo-memo-search',label);const control=make('select','attendigo-memo-search-input');for(const [value,name] of values){const option=make('option',null,name);option.value=value;control.append(option);}control.addEventListener('change',()=>{offset=0;void loadRepository();});wrap.append(control);return [wrap,control];};
  const [filterWrap,filterControl]=select('Status',[['all','All memoranda'],['active','Active'],['upcoming','Upcoming'],['past','Past / undated']]);statusFilter=filterControl;
  const [sortWrap,sortControl]=select('Sort by',[['newest','Newest first'],['oldest','Oldest first']]);sortFilter=sortControl;
  repositoryTools.append(filter,filterWrap,sortWrap);
  repositoryNav=make('div','attendigo-memo-repository-nav');repositoryNav.hidden=true;
  for(const [kind,label,delta] of [['previous','Previous',-15],['next','Next',15]]){
   const button=make('button','attendigo-memo-refresh',label);button.type='button';button.dataset.memoPage=kind;button.addEventListener('click',()=>{offset=Math.max(0,offset+delta);void loadRepository();});repositoryNav.append(button);
   if(kind==='previous')repositoryNav.append(make('span',null,'Page 1'));
  }
  allButton=make('button','attendigo-memo-view-all');allButton.type='button';allButton.append(make('strong',null,'View All Memoranda'),make('small',null,'Search publication history and available records'),make('span','attendigo-memo-row-arrow','›'));allButton.addEventListener('click',()=>openRepository(true));
  panel.append(heading,back,toolbar,status,repositoryTools,list,repositoryNav,allButton,footer);
  // Inline adjacent to the school notice, inside each user's existing dashboard.
  host.insertBefore(panel,host.firstChild);
  host.insertBefore(strip,panel);
  banner();return true;
 }
 async function open(id){
  if(!build()&&!panel)return false;
  opener=document.activeElement;
  if(documentId.test(String(id||''))){state.memoId=String(id);selectedMemo=null;view='detail';}
  else {state.memoId='';selectedMemo=null;view='home';}
  state.open=true;panel.hidden=false;banner();
  if(typeof panel.showModal==='function'&&!panel.open)panel.showModal();
  render();await load();
  if(!state.memoId)panel.querySelector('#attendigoMemoTitle')?.focus({preventScroll:true});
  return true;
 }
 function selectRole(){
  // Principal-only actions are additionally protected server-side.
  fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'})
   .then(r=>r.ok?r.json():null).then(d=>{
    state.role=d?.user?.mustChangePassword?'':(d?.user?.role||'');
    syncManager();ensureArchiveFilter();
    if(state.open)render();else banner();
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
   if(e.key==='Escape'&&state.open&&typeof panel.showModal!=='function'){if(view!=='home')goBack();else close();}
  });
  document.addEventListener('visibilitychange',()=>{
   if(!document.hidden)void refresh();
  });
  window.setInterval(()=>{if(!document.hidden)void refresh();},120000);
  const id=new URLSearchParams(location.search).get('memo');
  if(documentId.test(String(id||'')))void open(id);
  else void refresh();
 }
 async function refresh(options={}){
  if(!build())return;
  if(state.open){if(options.published){view='home';state.memoId='';selectedMemo=null;}await load();return;}
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
