'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validCampus,containsDepartment,trustedDepartmentPoint}=require('../staff-lunch-campus');
const campus={latitude:9,longitude:125,radiusMeters:500};
test('entire department radius plus location uncertainty fits trusted campus',()=>{
 assert.equal(containsDepartment(campus,{latitude:9,longitude:125,radiusMeters:120},20),true);
 assert.equal(containsDepartment(campus,{latitude:9.004,longitude:125,radiusMeters:120},20),false);
 assert.equal(containsDepartment(campus,{latitude:9,longitude:125,radiusMeters:500},0),false);
 assert.equal(validCampus({...campus,radiusMeters:5001}),false);
 assert.equal(validCampus({...campus,latitude:91}),false);
});
test('campus checks remain independent for 10, 50 and 100 overlapping department areas',()=>{
 for(const count of [10,50,100]){
  const areas=Array.from({length:count},(_,i)=>({latitude:9+(i%10)*0.0001,longitude:125+Math.floor(i/10)*0.0001,radiusMeters:60}));
  assert.equal(areas.filter(p=>containsDepartment(campus,p,20)).length,count);
  assert.equal(areas.filter(p=>containsDepartment({...campus,latitude:10},p,20)).length,0);
 }
});
test('campus lookup fails closed for missing or retired school-scoped campus',async()=>{
 const point={latitude:9,longitude:125,radiusMeters:120,campusId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'};
 const db={query:async(sql,params)=>{assert.match(sql,/school_id=\$1 AND campus_id=\$2 AND active=TRUE/);assert.match(sql,/FOR SHARE/);assert.equal(params[0],'school-a');return {rows:[]};}};
 assert.equal(await trustedDepartmentPoint(db,'school-a',point),null);
 assert.deepEqual(await trustedDepartmentPoint(db,'school-a',{latitude:9,longitude:125,radiusMeters:120}),{latitude:9,longitude:125,radiusMeters:120});
});
