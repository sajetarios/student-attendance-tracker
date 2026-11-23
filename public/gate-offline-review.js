(()=>{'use strict';
const $=id=>document.getElementById(id), host=$('offlineReviewRows');
async function api(path,options={}){
 const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',
  headers:{...(options.body?{'Content-Type':'application/json'}:{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Request failed; School Admin access required.');
 return data;
}
function text(tag,value){const e=document.createElement(tag);e.textContent=value??'';return e;}
async function load(){
 $('offlineReviewRefresh').disabled=true;
 try{
  const result=await api('/api/gate/offline/review');host.replaceChildren();
  const items=Array.isArray(result.items)?result.items:[];
  const pending=items.filter(item=>['REVIEW_REQUIRED','INVALID_BADGE'].includes(item.status)).length;
  $('offlineReviewSummaryCount').textContent=String(pending);
  $('offlineReviewSummaryLabel').textContent=pending===1?'Pending observation':'Pending observations';
  $('offlineReviewSummaryMeta').textContent=items.length+' synchronized observation'+(items.length===1?'':'s');
  $('offlineReviewMessage').textContent='';
  if(!items.length){
   const empty=document.createElement('div');empty.className='empty-state';
   const icon=text('span','✓');icon.className='empty-icon';icon.setAttribute('aria-hidden','true');
   empty.append(icon,text('h2','No offline scans to review'),
    text('p','Synchronized Gatekeeper observations that require a School Admin review will appear here.'));
   host.append(empty);return;
  }
  for(const item of items){
   const card=document.createElement('article');
   card.append(text('h2',item.subjectKind+' observation · '+item.status));
   const meta=document.createElement('p');meta.className='meta';
   for(const label of ['Reference: '+(item.subjectReference||'Unknown / inactive'),
    'Device claimed time: '+new Date(item.deviceTime).toLocaleString(),
    'Server received: '+new Date(item.serverReceivedAt).toLocaleString(),
    'Gatekeeper: '+item.gatekeeper]){
    const span=text('span',label);meta.append(span);
   }
   card.className='surface-card section-card';
   card.append(meta,text('p',item.reason),text('small',item.reviewNote||''));
   if(['REVIEW_REQUIRED','INVALID_BADGE'].includes(item.status)){
    const label=text('label','Review explanation (required; does not generate attendance)');
    const note=document.createElement('input');note.maxLength=500;note.placeholder='Why you are closing this observation';
    label.append(note);card.append(label);
    const actions=document.createElement('div');actions.className='review-actions';card.append(actions);
    for(const choice of [['CLOSED_REVIEWED','Mark reviewed'],['DISMISSED','Dismiss observation']]){
     const button=text('button',choice[1]);button.className='outline-button';
     button.addEventListener('click',async()=>{
      if(note.value.trim().length<8)return $('offlineReviewMessage').textContent='Enter a review explanation of at least 8 characters.';
      if(!window.confirm(choice[1]+'? No attendance record will be created.'))return;
      button.disabled=true;
      try{
       await api('/api/gate/offline/review/'+encodeURIComponent(item.eventId),
        {method:'POST',body:JSON.stringify({status:choice[0],note:note.value.trim()})});
       await load();
      }catch(e){$('offlineReviewMessage').textContent=e.message;button.disabled=false;}
     });actions.append(button);
    }
   }
   host.append(card);
  }
 }catch(e){$('offlineReviewMessage').textContent=e.message;$('offlineReviewSummaryCount').textContent='—';$('offlineReviewSummaryMeta').textContent='Unable to load observations.';}
 finally{$('offlineReviewRefresh').disabled=false;}
}
$('offlineReviewRefresh').addEventListener('click',load);
document.addEventListener('attendigo:offline-reviews-open',load);
})();
