'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {distanceMeters,validateDepartmentPoint,classifyDepartmentPresence,assessLocationEvidence}=require('../staff-lunch-location');
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

test('fresh stable high-accuracy samples provide bounded department proximity evidence',()=>{
 const now=Date.now();
 const readings={samples:[
  {latitude:9.006,longitude:125.498,accuracyMeters:36,capturedAt:now-2100},
  {latitude:9.00601,longitude:125.49801,accuracyMeters:31,capturedAt:now-700}
 ]};
 const assessed=assessLocationEvidence(readings,now);
 assert.equal(assessed.valid,true);
 assert.equal(assessed.confidence,'STABLE_MULTIPLE');
 assert.equal(classifyDepartmentPresence(point,readings,now).verified,true);
 const oneLessPrecise={...here,accuracyMeters:38,capturedAt:now-900};
 assert.equal(classifyDepartmentPresence(point,oneLessPrecise,now).reason,'LOCATION_CONFIDENCE_LOW');
 const impossible={samples:[
  {...readings.samples[0]},
  {...readings.samples[1],latitude:10.006,longitude:125.498}
 ]};
 assert.equal(classifyDepartmentPresence(point,impossible,now).reason,'LOCATION_SAMPLES_CONFLICT');
});
test('precision is respected at boundaries and invalid series cannot bypass checks',()=>{
 const now=Date.now();
 const nearEdge={latitude:9.0069,longitude:125.498,accuracyMeters:42,capturedAt:now-600};
 const measured={samples:[
  {...nearEdge,capturedAt:now-2400},
  {...nearEdge,latitude:9.00691,capturedAt:now-600}
 ]};
 assert.equal(classifyDepartmentPresence(point,measured,now).reason,'DEPARTMENT_BOUNDARY_UNCERTAIN');
 assert.equal(classifyDepartmentPresence(point,{samples:[]},now).reason,'LOCATION_EVIDENCE_INVALID');
 assert.equal(classifyDepartmentPresence(point,{samples:Array(6).fill(here)},now).reason,'LOCATION_EVIDENCE_INVALID');
 const future={...here,capturedAt:now+120000};
 assert.equal(classifyDepartmentPresence(point,future,now).reason,'LOCATION_SAMPLE_STALE');
});
