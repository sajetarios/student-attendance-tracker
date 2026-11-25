'use strict';
// Shared browser/server catalog. Only request-backed information may be populated.
(function(root){
 const groups=[
 ['Employee information',[
 ['name','Employee name','MARIA A. DELA CRUZ-SANTOS'],['position','Position / designation','Teacher III'],['station','Permanent station / school','Sample National High School']]],
 ['Official travel details',[
 ['purpose','Purpose / activity','Submission of school reports and attendance at a division meeting'],['destination','Destination','Schools Division Office'],['business','Official Business checkbox','✓'],['officialTime','Official Time checkbox (leave blank for OB)','']]],
 ['Date and time',[
 ['event','Combined scheduled date and time','Nov 26, 2026 | 8:00 AM – 12:00 PM'],['travelDate','Travel date (short)','Nov 26, 2026'],['travelDateLong','Travel date (long)','November 26, 2026'],['travelDateNumeric','Travel date (DD/MM/YYYY)','26/11/2026'],['departTime','Scheduled departure / start','8:00 AM'],['returnTime','Scheduled return / end','12:00 PM'],['timeRange','Scheduled time range','8:00 AM – 12:00 PM'],['startDateTime','Scheduled start date and time','Nov 26, 2026, 8:00 AM'],['endDateTime','Scheduled end date and time','Nov 26, 2026, 12:00 PM'],['filed','Date filed (short)','Nov 25, 2026'],['filedLong','Date filed (long)','November 25, 2026']]],
 ['School identity and approval',[
 ['region','Region','Region XI'],['division','Schools Division','Sample Schools Division'],['schoolName','School name','Sample National High School'],['head','School Head name','JUAN A. DELA CRUZ, EdD'],['headPosition','School Head designation','Principal II']]]
 ];
 const fields=groups.flatMap(([group,items])=>items.map(([key,label,sample])=>({key,label,sample,group})));
 const byKey=new Map(fields.map(f=>[f.key,f]));
 const baseKey=key=>typeof key==='string'?key.replace(/__(?:[2-5])$/,''):'';
 const descriptor=key=>{const base=baseKey(key),f=byKey.get(base);if(!f||!([base,...[2,3,4,5].map(i=>base+'__'+i)].includes(key)))return null;return f;};
 const checkbox=key=>['business','officialTime'].includes(baseKey(key));
 const has=(mapping,key)=>Object.keys(mapping||{}).some(k=>baseKey(k)===key&&descriptor(k));
 const required=['name','position','station','purpose','destination','event'];
 function missing(mapping){
  const present=key=>has(mapping,key);
  const remaining=required.slice(0,5).filter(k=>!present(k)&&!(k==='station'&&present('schoolName')));
  const date=['travelDate','travelDateLong','travelDateNumeric','startDateTime','endDateTime'].some(present);
  const start=present('departTime')||present('startDateTime')||present('timeRange');
  const end=present('returnTime')||present('endDateTime')||present('timeRange');
  if(!present('event')&&!(date&&start&&end))remaining.push('event');
  return remaining;
 }
 const label=key=>{const f=descriptor(key);return f?f.label+(key!==f.key?' (placement '+key.split('__')[1]+')':''):key;};
 const canRemove=(mapping,key)=>{const next={...mapping};delete next[key];return missing(next).length===0;};
 const api={groups,fields,descriptor,baseKey,checkbox,has,missing,required,label,canRemove};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.AttendigoLocatorFields=api;
})(typeof globalThis==='object'?globalThis:this);
