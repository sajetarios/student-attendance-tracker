'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {heatBand,normalize,createWeatherCache}=require('../school-weather-routes');
const now=Date.UTC(2026,10,26,0);
const fixture={current:{last_updated_epoch:now/1000,temp_c:33,heatindex_c:42,humidity:70,wind_kph:5,condition:{text:'Partly cloudy'}},forecast:{forecastday:[{hour:[{time_epoch:now/1000+3600,temp_c:34,heatindex_c:44,chance_of_rain:20}]}]}};
test('PAGASA category boundaries, provider fields and missing data',()=>{
 for(const [v,label] of [[26,'Below caution threshold'],[27,'Caution'],[33,'Extreme caution'],[42,'Danger'],[52,'Extreme danger']])assert.equal(heatBand(v),label);
 const d=normalize(fixture,now);assert.equal(d.heatIndex,42);assert.equal(d.hourly[0].rainChance,20);assert.throws(()=>normalize({current:{temp_c:32}},now));assert.throws(()=>normalize(fixture,now+3*3600000));
});
test('concurrent requests collapse; shared cache; provider errors do not fabricate data',async()=>{
 let calls=0,t=now,fail=false;
 const get=createWeatherCache({now:()=>t,key:()=> 'test',fetchImpl:async url=>{calls++;assert.equal(url.hostname,'api.weatherapi.com');if(fail)throw Error('offline');return {ok:true,json:async()=>fixture};}});
 const results=await Promise.all(Array.from({length:30},()=>get(7,125)));
 assert.equal(calls,1);assert.ok(results.every(r=>r.status==='live'&&r.weather.temperature===33));
 await get(7,125);assert.equal(calls,1);t+=31*60000;fail=true;assert.equal((await get(7,125)).status,'stale');assert.equal(calls,2);
 t+=2*3600000;assert.equal((await get(7,125)).status,'unavailable');
});
test('no key makes no provider request',async()=>{const get=createWeatherCache({key:()=>'',fetchImpl:()=>{throw Error('must not request');}});assert.deepEqual(await get(7,125),{status:'not_configured'});});
