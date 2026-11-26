'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {heatIndex,heatBand,normalize,createWeatherCache,registerSchoolWeatherRoutes}=require('../school-weather-routes');
const now=Date.UTC(2026,10,26,0);
const fixture={properties:{meta:{updated_at:new Date(now-3600000).toISOString()},timeseries:Array.from({length:8},(_,i)=>({time:new Date(now+i*3600000).toISOString(),data:{instant:{details:{air_temperature:33,relative_humidity:70,wind_speed:2}},next_1_hours:{summary:{symbol_code:'partlycloudy_day'},details:{precipitation_amount:0.4}}}}))}};
const hdr=(o={})=>({get:key=>o[key]||null});
test('NOAA heat index, category boundaries, MET model time and rain amount',()=>{
 assert.equal(heatIndex(32.222222,70),41);assert.equal(heatIndex(null,70),null);
 for(const [v,label] of [[26,'Below caution threshold'],[27,'Caution'],[33,'Extreme caution'],[42,'Danger'],[52,'Extreme danger']])assert.equal(heatBand(v),label);
 const d=normalize(fixture,now);assert.equal(d.temperature,33);assert.equal(d.hourly[0].rainMm,.4);assert.equal(d.source,'MET Norway');assert.equal(d.windKph,7);assert.equal(d.validAt,new Date(now).toISOString());assert.equal(d.modelUpdatedAt,new Date(now-3600000).toISOString());assert.throws(()=>normalize({},now));assert.throws(()=>normalize(fixture,now+40*3600000));
});
test('cache honors Expires, sends conditional request, collapses concurrency and handles stale forecasts',async()=>{
 let calls=0,t=now,fail=false;const modified=new Date(now-3600000).toUTCString();
 const get=createWeatherCache({now:()=>t,fetchImpl:async(url,options)=>{calls++;assert.equal(url.hostname,'api.met.no');assert.equal(url.searchParams.get('lat'),'7.000');assert.match(options.headers['User-Agent'],/Attendigo/);if(fail)throw Error('offline');if(calls===2){assert.equal(options.headers['If-Modified-Since'],modified);return {status:304,headers:hdr()};}return {ok:true,status:200,headers:hdr({'expires':new Date(now+60*60000).toUTCString(),'last-modified':modified}),json:async()=>fixture};}});
 const results=await Promise.all(Array.from({length:30},()=>get(7,125)));
 assert.equal(calls,1);assert.ok(results.every(r=>r.status==='live'&&r.weather.temperature===33));t+=31*60000;await get(7,125);assert.equal(calls,1);t+=30*60000;assert.equal((await get(7,125)).status,'live');assert.equal(calls,2);t+=31*60000;fail=true;assert.equal((await get(7,125)).status,'stale');t+=3*3600000;assert.equal((await get(7,125)).status,'unavailable');
});
test('provider throttling stops unrelated location calls',async()=>{let calls=0;const get=createWeatherCache({now:()=>now,fetchImpl:async()=>{calls++;return {status:429,headers:hdr({'retry-after':'600'})};}});assert.equal((await get(7,125)).status,'unavailable');assert.equal((await get(8,125)).status,'unavailable');assert.equal(calls,1);});
test('weather routes constrain campus to authenticated school and allowed roles',async()=>{let handlers,roles;const auth=()=>{};const pool={query:async(sql,args)=>{assert.match(sql,/school_id=\$1/);assert.deepEqual(args,['school-a']);return {rows:[]};}};registerSchoolWeatherRoutes({get:(path,...h)=>{assert.equal(path,'/api/school/weather');handlers=h;}},pool,{authenticateSchoolClient:auth,requireSchoolRoles:(...r)=>{roles=r;return ()=>{};}});assert.equal(handlers[0],auth);assert.deepEqual(roles,['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','PRINCIPAL']);let result;await handlers[2]({auth:{schoolId:'school-a'},query:{}},{setHeader:()=>{},json:d=>{result=d;}});assert.equal(result.status,'no_campus');});

test('compact weather info keeps attribution visible and safety details opt-in',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
 const widget=read('school-weather-widget.js'),css=read('attendigo-signature.css');
 const handlers={},attrs={};const node={addEventListener(){},querySelector(){return node;},options:[]};
 const info={addEventListener:(event,fn)=>{handlers[event]=fn;},setAttribute:(key,value)=>{attrs[key]=value;},focus(){handlers.focused=true;}};
 const panel={hidden:true};
 const root={classList:{add(){}},querySelector:s=>s==='.ax-weather-info'?info:s==='.ax-weather-info-panel'?panel:node,addEventListener:(event,fn)=>{handlers[event]=fn;}};
 const document={querySelectorAll:()=>[],addEventListener(){},getElementById:()=>null};
 const window={addEventListener(){}};
 vm.runInNewContext(widget,{document,window,IntersectionObserver:class{observe(){}},setInterval(){}});
 window.AttendigoSchoolWeather.mount(root);
 assert.match(root.innerHTML,/class="outline-button ax-weather-info"[^>]*aria-expanded="false"/);
 assert.match(root.innerHTML,/class="ax-weather-info-panel" hidden/);
 assert.match(root.innerHTML,/MET Norway/);assert.match(root.innerHTML,/CC BY 4\.0/);assert.match(root.innerHTML,/Adapted by Attendigo/);
 assert.match(root.innerHTML,/official class suspension notice/);assert.match(root.innerHTML,/PAGASA advisories/);
 assert.doesNotMatch(root.innerHTML,/Forecast details &amp; safety information/);
 handlers.click();assert.equal(panel.hidden,false);assert.equal(attrs['aria-expanded'],'true');
 handlers.keydown({key:'Escape'});assert.equal(panel.hidden,true);assert.equal(attrs['aria-expanded'],'false');assert.equal(handlers.focused,true);
 assert.match(css,/\.ax-weather-footer \{display:grid;grid-template-columns:minmax\(0,1fr\) 44px/);
});
