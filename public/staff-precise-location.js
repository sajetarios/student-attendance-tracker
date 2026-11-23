'use strict';
// Collect a few fresh high-accuracy observations without blocking a weak
// connection indefinitely. Browser GPS is approximate, never proof of presence.
(() => {
 const MAX_MS=8500,MAX_SAMPLES=5,GOOD_METERS=45;
 function measure(reading){
  const c=reading?.coords;
  if(!c||![c.latitude,c.longitude,c.accuracy].every(Number.isFinite)||
     !Number.isFinite(reading.timestamp)||c.accuracy<=0)return null;
  return {latitude:c.latitude,longitude:c.longitude,
   accuracyMeters:c.accuracy,capturedAt:reading.timestamp};
 }
 function collectPreciseLocation({onProgress}={}){
  if(!navigator.geolocation||!window.isSecureContext)
   return Promise.reject(Error('A secure connection and device location access are required.'));
  return new Promise((resolve,reject)=>{
   let done=false,watchId=null,timer=null,fallback=null;
   const samples=[];
   const finish=(error)=>{
    if(done)return;done=true;
    if(timer!==null)clearTimeout(timer);
    if(fallback!==null)clearTimeout(fallback);
    if(watchId!==null)navigator.geolocation.clearWatch(watchId);
    if(error&&samples.length===0){reject(error);return;}
    if(!samples.length){reject(Error('No fresh GPS reading was available.'));return;}
    const best=[...samples].sort((a,b)=>a.accuracyMeters-b.accuracyMeters)[0];
    resolve({...best,samples});
   };
   const onReading=reading=>{
    if(done)return;
    const point=measure(reading);if(!point)return;
    if(Math.abs(Date.now()-point.capturedAt)>30000)return;
    if(samples.some(s=>s.capturedAt===point.capturedAt))return;
    samples.push(point);if(samples.length>MAX_SAMPLES)samples.shift();
    if(typeof onProgress==='function'){
     onProgress({accuracyMeters:Math.round(Math.min(...samples.map(s=>s.accuracyMeters))),
      sampleCount:samples.length});
    }
    // Early completion is for speed. Low-quality readings use the whole
    // bounded collection window and are later reviewed, not auto-approved.
    const good=samples.filter(s=>s.accuracyMeters<=GOOD_METERS);
    if(good.length>=2&&Math.abs(good.at(-1).capturedAt-good.at(-2).capturedAt)>=500)
     finish();
   };
   const onError=error=>{
    if(done)return;
    if(error?.code===1)finish(error); // Permission explicitly denied.
    // Transient timeouts still allow later readings or the fallback request.
   };
   timer=setTimeout(()=>finish(),MAX_MS);
   try{
    watchId=navigator.geolocation.watchPosition(onReading,onError,
     {enableHighAccuracy:true,maximumAge:0,timeout:6500});
   }catch(error){finish(error);return;}
   // Some browsers do not emit another watch update while the phone is still.
   fallback=setTimeout(()=>{
    if(done)return;
    navigator.geolocation.getCurrentPosition(onReading,onError,
     {enableHighAccuracy:true,maximumAge:0,timeout:4000});
   },2400);
  });
 }
 window.attendigoPreciseLocation={collectPreciseLocation};
})();
