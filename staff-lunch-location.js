'use strict';
// Coarse browser geolocation is an anti-abuse signal, not proof of physical presence.
// Never accept the phone clock as an authoritative DTR timestamp.
const DEFAULT_RADIUS_METERS = 120;
const MAX_LOCATION_ACCURACY_METERS = 100;
const MAX_LOCATION_AGE_MS = 90_000;
const EARTH_RADIUS_M = 6371000;
function validLatitudeLongitude(latitude, longitude) {
 return typeof latitude==='number' && Number.isFinite(latitude) && latitude>=-90 && latitude<=90 &&
   typeof longitude==='number' && Number.isFinite(longitude) && longitude>=-180 && longitude<=180;
}
function distanceMeters(a, b) {
 const rad=n=>n*Math.PI/180, dLat=rad(b.latitude-a.latitude), dLon=rad(b.longitude-a.longitude);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
 return Math.round(EARTH_RADIUS_M*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)));
}
function validateDepartmentPoint(input) {
 const latitude=input?.latitude, longitude=input?.longitude;
 const accuracyMeters=input?.accuracyMeters, radiusMeters=input?.radiusMeters??DEFAULT_RADIUS_METERS;
 if(!validLatitudeLongitude(latitude,longitude) ||
   typeof accuracyMeters!=='number'||!Number.isFinite(accuracyMeters)||accuracyMeters<=0||accuracyMeters>100 ||
   !Number.isInteger(radiusMeters)||radiusMeters<60||radiusMeters>250)
   throw new RangeError('Use a precise department location (100 m accuracy or better) and a radius between 60 and 250 m.');
 return {latitude,longitude,radiusMeters};
}
function classifyDepartmentPresence(point, observed, now=Date.now()) {
 if(!point||!validLatitudeLongitude(point.latitude,point.longitude) ||
    !Number.isInteger(point.radiusMeters)||point.radiusMeters<60||point.radiusMeters>250)
   return {verified:false,reason:'DEPARTMENT_LOCATION_NOT_CONFIGURED'};
 if(!observed||!validLatitudeLongitude(observed.latitude,observed.longitude) ||
   typeof observed.accuracyMeters!=='number'||!Number.isFinite(observed.accuracyMeters)||
   observed.accuracyMeters<=0 || !Number.isFinite(observed.capturedAt))
   return {verified:false,reason:'LOCATION_NOT_AVAILABLE'};
 // Client-reported sampling time can be manipulated and is never authoritative.
 const age=now-observed.capturedAt;
 if(age< -10_000 || age>MAX_LOCATION_AGE_MS)
   return {verified:false,reason:'LOCATION_SAMPLE_STALE'};
 if(observed.accuracyMeters>MAX_LOCATION_ACCURACY_METERS)
   return {verified:false,reason:'LOCATION_ACCURACY_LOW',accuracyMeters:Math.round(observed.accuracyMeters)};
 const distance=distanceMeters(point,observed);
 if(distance>point.radiusMeters)
   return {verified:false,reason:'OUTSIDE_DEPARTMENT_AREA',distanceMeters:distance,accuracyMeters:Math.round(observed.accuracyMeters)};
 return {verified:true,reason:'DEPARTMENT_PROXIMITY',distanceMeters:distance,accuracyMeters:Math.round(observed.accuracyMeters)};
}
module.exports={DEFAULT_RADIUS_METERS,MAX_LOCATION_ACCURACY_METERS,MAX_LOCATION_AGE_MS,
 validLatitudeLongitude,distanceMeters,validateDepartmentPoint,classifyDepartmentPresence};
