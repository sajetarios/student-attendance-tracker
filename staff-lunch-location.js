'use strict';
// Browser geolocation is a spoofable risk signal, never verified indoor presence.
// The server owns receipt time, DTR classification and all attendance decisions.
const DEFAULT_RADIUS_METERS=120;
const MAX_LOCATION_ACCURACY_METERS=100;
const MAX_LOCATION_AGE_MS=90_000;
const MAX_AUTO_ACCURACY_METERS=70;
const MAX_SAMPLES=5;
const EARTH_RADIUS_M=6371000;
function validLatitudeLongitude(latitude,longitude){
 return typeof latitude==='number'&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&
   typeof longitude==='number'&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180;
}
function distanceMeters(a,b){
 const rad=n=>n*Math.PI/180,dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
 return Math.round(EARTH_RADIUS_M*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)));
}
function validSample(sample){
 return !!sample&&validLatitudeLongitude(sample.latitude,sample.longitude)&&
  typeof sample.accuracyMeters==='number'&&Number.isFinite(sample.accuracyMeters)&&
  sample.accuracyMeters>0&&sample.accuracyMeters<=10000&&
  typeof sample.capturedAt==='number'&&Number.isFinite(sample.capturedAt);
}
function validateDepartmentPoint(input){
 const latitude=input?.latitude,longitude=input?.longitude;
 const accuracyMeters=input?.accuracyMeters,radiusMeters=input?.radiusMeters??DEFAULT_RADIUS_METERS;
 if(!validLatitudeLongitude(latitude,longitude)||
   typeof accuracyMeters!=='number'||!Number.isFinite(accuracyMeters)||
   accuracyMeters<=0||accuracyMeters>100||
   !Number.isInteger(radiusMeters)||radiusMeters<60||radiusMeters>250)
  throw new RangeError('Use a department location with reported accuracy of 100 m or better and a radius of 60–250 m.');
 return {latitude,longitude,radiusMeters};
}
// Accept a bounded series of measurements. Repeated identical positions from
// the same phone are not independent proof of presence, so one excellent
// measurement is permitted and all weak/ambiguous measurements go to review.
function assessLocationEvidence(observed,now=Date.now()){
 if(!observed||typeof observed!=='object'||Array.isArray(observed))
  return {valid:false,reason:'LOCATION_NOT_AVAILABLE'};
 const hasSeries=Object.prototype.hasOwnProperty.call(observed,'samples');
 if(hasSeries&&(!Array.isArray(observed.samples)||observed.samples.length<1||
   observed.samples.length>MAX_SAMPLES))
  return {valid:false,reason:'LOCATION_EVIDENCE_INVALID'};
 const samples=hasSeries?observed.samples:[observed];
 if(samples.some(s=>!validSample(s)))
  return {valid:false,reason:'LOCATION_EVIDENCE_INVALID'};
 const fresh=samples.filter(s=>{
  const age=now-s.capturedAt;
  return age>=-10_000&&age<=MAX_LOCATION_AGE_MS;
 });
 if(!fresh.length)return {valid:false,reason:'LOCATION_SAMPLE_STALE'};
 const sorted=[...fresh].sort((a,b)=>a.accuracyMeters-b.accuracyMeters);
 const best=sorted[0];
 if(best.accuracyMeters>MAX_LOCATION_ACCURACY_METERS)
  return {valid:false,reason:'LOCATION_ACCURACY_LOW',accuracyMeters:Math.round(best.accuracyMeters),sampleCount:fresh.length};
 // If measurements disagree substantially, fail safe instead of picking the
 // convenient coordinate. The 100 m ceiling tolerates indoor GPS drift.
 for(const s of fresh){
  const gap=distanceMeters(best,s);
  const maxGap=Math.max(35,Math.min(100,best.accuracyMeters+s.accuracyMeters));
  if(gap>maxGap)
   return {valid:false,reason:'LOCATION_SAMPLES_CONFLICT',
    accuracyMeters:Math.round(best.accuracyMeters),sampleCount:fresh.length};
 }
 const supporting=fresh.filter(s=>s!==best&&s.accuracyMeters<=MAX_AUTO_ACCURACY_METERS&&
   Math.abs(s.capturedAt-best.capturedAt)>=500);
 const confidence=best.accuracyMeters<=25?'EXCELLENT_SINGLE':
   best.accuracyMeters<=MAX_AUTO_ACCURACY_METERS&&supporting.length?'STABLE_MULTIPLE':null;
 if(!confidence)
  return {valid:false,reason:'LOCATION_CONFIDENCE_LOW',
   accuracyMeters:Math.round(best.accuracyMeters),sampleCount:fresh.length};
 return {valid:true,reason:'LOCATION_EVIDENCE_QUALIFIED',
  point:best,accuracyMeters:Math.round(best.accuracyMeters),
  sampleCount:fresh.length,confidence};
}
function classifyDepartmentPresence(point,observed,now=Date.now()){
 if(!point||!validLatitudeLongitude(point.latitude,point.longitude)||
   !Number.isInteger(point.radiusMeters)||point.radiusMeters<60||point.radiusMeters>250)
  return {verified:false,reason:'DEPARTMENT_LOCATION_NOT_CONFIGURED'};
 const assessed=assessLocationEvidence(observed,now);
 if(!assessed.valid)
  return {verified:false,reason:assessed.reason,
   accuracyMeters:assessed.accuracyMeters,sampleCount:assessed.sampleCount};
 const distance=distanceMeters(point,assessed.point);
 // If the reported uncertainty overlaps the radius boundary, do not silently
 // mark the employee as verified; flag for independent review.
 if(distance+assessed.accuracyMeters>point.radiusMeters)
  return {verified:false,reason:distance>point.radiusMeters?
   'OUTSIDE_DEPARTMENT_AREA':'DEPARTMENT_BOUNDARY_UNCERTAIN',
   distanceMeters:distance,accuracyMeters:assessed.accuracyMeters,
   sampleCount:assessed.sampleCount};
 return {verified:true,reason:'DEPARTMENT_PROXIMITY',
  distanceMeters:distance,accuracyMeters:assessed.accuracyMeters,
  sampleCount:assessed.sampleCount,confidence:assessed.confidence};
}
module.exports={DEFAULT_RADIUS_METERS,MAX_LOCATION_ACCURACY_METERS,MAX_LOCATION_AGE_MS,
 MAX_AUTO_ACCURACY_METERS,MAX_SAMPLES,validLatitudeLongitude,distanceMeters,
 validSample,assessLocationEvidence,validateDepartmentPoint,classifyDepartmentPresence};
