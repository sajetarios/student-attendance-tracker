'use strict';
(() => {
 const api='/api/staff-attendance/official-business';
 const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 async function responseError(response){
  const data=await response.json().catch(()=>({}));
  const error=Error(data.error||'Could not prepare the Locator Slip. Please retry.');error.code=data.code;return error;
 }
 function attach(container,id,options={}){
  const button=make('button',options.buttonClass||'outline-button',options.label||'Print / download Locator Slip');
  button.type='button';
  const status=make('p','source-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.overflowWrap='anywhere';
  const panel=make('div','locator-slip-feedback');panel.hidden=true;panel.style.cssText='flex-basis:100%;min-width:0;max-width:100%';
  panel.append(status);
  let working=false;
  function feedback(message){panel.hidden=false;status.textContent=message;}
  function clearExtra(){while(panel.children.length>1)panel.lastElementChild.remove();}
  async function generate(){
   if(working)return;
   working=true;button.disabled=true;clearExtra();feedback('Preparing your official Locator Slip…');
   try{
    const response=await fetch(api+'/'+encodeURIComponent(id)+'/locator-slip',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/pdf'}});
    if(!response.ok)throw await responseError(response);
    if(!String(response.headers.get('content-type')).toLowerCase().startsWith('application/pdf'))throw Error('The server did not return a PDF. Please sign in again and retry.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<1000||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw Error('The server did not return a complete PDF. Please retry.');
    const url=api+'/'+encodeURIComponent(id)+'/locator-slip';
    const link=make('a',options.buttonClass||'outline-button','Open PDF');link.href=url;link.target='_blank';link.rel='noopener';
    const save=make('a',options.buttonClass||'outline-button','Download PDF');save.href=url+'?download=1';
    feedback('Your PDF is ready. Open it in the browser or download it to Files, then print and obtain the required signatures.');
    panel.append(link,save);
   }catch(error){
    feedback(error.message);
    if(error.code==='LOCATOR_TEMPLATE_REQUIRED'){
     const note=make('p','source-note','One-time setup for all users: select the unmodified official DepEd Revised Annex E PDF. Do not select a completed or signed employee slip.');
     const input=make('input');input.type='file';input.accept='application/pdf,.pdf';input.setAttribute('aria-label','Original official Locator Slip PDF');input.style.maxWidth='100%';
     const upload=make('button',options.buttonClass||'outline-button','Install official master & retry');upload.type='button';
     upload.addEventListener('click',async()=>{
      const file=input.files&&input.files[0];if(!file){feedback('Select the original official PDF first.');return;}
      if(file.size!==109793){feedback('Select the original unmodified DepEd Revised Annex E PDF, not a completed slip.');return;}
      upload.disabled=true;button.disabled=true;input.disabled=true;
      try{
       const response=await fetch(api+'/locator-template',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/pdf'},body:file});
       if(!response.ok)throw await responseError(response);
       await generate();
      }catch(e){feedback(e.message);upload.disabled=false;button.disabled=false;input.disabled=false;}
     });
     panel.append(note,input,upload);
    }
   }finally{working=false;button.disabled=false;}
  }
  button.addEventListener('click',()=>void generate());container.append(button,panel);
 }
 window.AttendigoLocatorSlip={attach};
})();