'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {distanceMeters,validateDepartmentPoint,classifyDepartmentPresence}=require('../staff-lunch-location');
const point={latitude:9.006,longitude:125.498,radiusMeters:120};
const here={latitude:9.006,longitude:125.498,accuracyMeters:12,capturedAt:Date.now()};
test('department geofence accepts only bounded configuration',()=>{
 assert.deepEqual(validateDepartmentPoint({...point,accuracyMeters:9}),point);
 for(const data of [
  {...point,accuracyMeters:102},{...point,accuracyMeters:10,radiusMeters:500},
  {...point,accuracyMeters:10,latitude:99},{...point,accuracyMeters:10,longitude:'125'},
  {...point,accuracyMeters:10,radiusMeters:10}
 ])assert.throws(()=>validateDepartmentPoint(data));
});
test('teacher presence near configured department is a risk signal',()=>{
 assert.ok(distanceMeters(point,here)<10);
 assert.equal(classifyDepartmentPresence(point,here).verified,true);
 const outside={...here,latitude:10,longitude:125.498};
 assert.equal(classifyDepartmentPresence(point,outside).reason,'OUTSIDE_DEPARTMENT_AREA');
 assert.equal(classifyDepartmentPresence(point,{...here,accuracyMeters:350}).reason,'LOCATION_ACCURACY_LOW');
 assert.equal(classifyDepartmentPresence(point,{...here,capturedAt:Date.now()-100_000}).reason,'LOCATION_SAMPLE_STALE');
 assert.equal(classifyDepartmentPresence(null,here).reason,'DEPARTMENT_LOCATION_NOT_CONFIGURED');
 assert.equal(classifyDepartmentPresence(point,null).reason,'LOCATION_NOT_AVAILABLE');
});
