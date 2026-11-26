'use strict';
const TTL=30*60*1000,STALE=2*60*60*1000,RETRY=5*60*1000,MAX=500;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
function heatBand(v){
 if(v===null||!Number.isFinite(v))return null;
 return v>=52?'Extreme danger':v>=42?'Danger':v>=33?'Extreme caution':v>=27?'Caution':'Below caution threshold';
}
function normalize(data,now){
 const c=data?.current,observed=number(c?.last_updated_epoch,1,4102444800);
 if(!c||observed===null||observed*1000>now+300000||now-observed*1000>STALE)throw Error('Invalid or old weather observation');
 const temperature=number(c.temp_c,-70,65),heat=number(c.heatindex_c,-70,100);
 if(temperature===null||heat===null)throw Error('Missing temperature or heat index');
 const hourly=(data.forecast?.forecastday||[]).flatMap(d=>Array.isArray(d.hour)?d.hour:[]).filter(h=>number(h.time_epoch,1,4102444800)!==null&&h.time_epoch*1000>=now).slice(0,6).map(h=>({time:new Date(h.time_epoch*1000).toISOString(),temperature:number(h.temp_c,-70,65),heatIndex:number(h.heatindex_c,-70,100),rainChance:number(h.chance_of_rain,0,100)}));
 return {temperature,heatIndex:heat,heatBand:heatBand(heat),humidity:number(c.humidity,0,100),windKph:number(c.wind_kph,0,400),condition:String(c.condition?.text||'').slice(0,100),observedAt:new Date(observed*1000).toISOString(),hourly,source:'WeatherAPI.com',fetchedAt:new Date(now).toISOString()};
}
function createWeatherCache({fetchImpl=global.fetch,now=Date.now,key=()=>process.env.WEATHERAPI_KEY}={}){
 const cache=new Map(),pending=new Map();
 return async function get(lat,lon){
  if(!String(key()||'').trim())return {status:'not_configured'};
  const coordinate=Number(lat).toFixed(3)+','+Number(lon).toFixed(3);
  const old=cache.get(coordinate),t=now();
  if(old&&old.retryAt>t){
   if(old.data&&t-Date.parse(old.data.observedAt)<=STALE)return {status:old.failed?'stale':'live',weather:old.data};
   return {status:'unavailable'};
  }
  if(pending.has(coordinate))return pending.get(coordinate);
  if(pending.size>=32)return {status:'unavailable'};
  const request=(async()=>{
   try{
    const url=new URL('https://api.weatherapi.com/v1/forecast.json');url.searchParams.set('key',key());url.searchParams.set('q',coordinate);url.searchParams.set('days','2');url.searchParams.set('aqi','no');url.searchParams.set('alerts','no');
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(6000),redirect:'error'});
    if(!response.ok)throw Error('Weather provider unavailable');
    const data=normalize(await response.json(),now());
    cache.set(coordinate,{data,retryAt:now()+TTL,failed:false});
    return {status:'live',weather:data};
   }catch{
    const data=old?.data&&now()-Date.parse(old.data.observedAt)<=STALE?old.data:null;
    cache.set(coordinate,{data,retryAt:now()+RETRY,failed:true});
    return data?{status:'stale',weather:data}:{status:'unavailable'};
   }finally{
    if(cache.size>MAX)cache.delete(cache.keys().next().value);
   }
  })();
  pending.set(coordinate,request);
  try{return await request;}finally{pending.delete(coordinate);}
 };
}
function registerSchoolWeatherRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const get=createWeatherCache(),campusCache=new Map();
 app.get('/api/school/weather',authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','PRINCIPAL'),async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  try{
   const school=req.auth.schoolId;
   let entry=campusCache.get(school);
   if(!entry||entry.expiry<=Date.now()){
    const r=await pool.query('SELECT campus_id AS id,name,latitude,longitude FROM staff_lunch_campuses WHERE school_id=$1 AND active=TRUE ORDER BY name,campus_id LIMIT 100',[school]);
    entry={expiry:Date.now()+300000,rows:r.rows.filter(c=>c.latitude!==null&&c.longitude!==null&&Number.isFinite(Number(c.latitude))&&Number.isFinite(Number(c.longitude))&&Math.abs(Number(c.latitude))<=90&&Math.abs(Number(c.longitude))<=180)};
    if(campusCache.size>=MAX)campusCache.delete(campusCache.keys().next().value);campusCache.set(school,entry);
   }
   const campuses=entry.rows.map(({id,name})=>({id,name}));
   if(!campuses.length)return res.json({status:'no_campus',campuses});
   const requested=req.query.campus;
   if(requested!==undefined&&(!UUID.test(String(requested))||typeof requested!=='string'))return res.status(400).json({error:'Invalid campus'});
   const selected=requested?entry.rows.find(c=>c.id===requested):entry.rows[0];
   if(!selected)return res.status(404).json({error:'Campus unavailable'});
   const result=await get(selected.latitude,selected.longitude);
   return res.json({...result,campuses,campus:{id:selected.id,name:selected.name}});
  }catch{return res.status(503).json({status:'unavailable'});}
 });
}
module.exports={heatBand,normalize,createWeatherCache,registerSchoolWeatherRoutes};
