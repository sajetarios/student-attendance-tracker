'use strict';
// MET Norway Locationforecast: CC BY 4.0; forecasts, never sensor observations.
const TTL=30*60*1000,STALE=2*60*60*1000,RETRY=5*60*1000,MAX=500;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
function heatIndex(c,r){
 if(number(c,-70,60)===null||number(r,0,100)===null)return null;
 const t=c*9/5+32;
 if(t>112)return null; // avoid unsupported extrapolation
 let h=(.5*(t+61+(t-68)*1.2+r*.094)+t)/2;
 if(h>=80){
  h=-42.379+2.04901523*t+10.14333127*r-.22475541*t*r-.00683783*t*t-.05481717*r*r+.00122874*t*t*r+.00085282*t*r*r-.00000199*t*t*r*r;
  if(r<13&&t>=80&&t<=112)h-=((13-r)/4)*Math.sqrt((17-Math.abs(t-95))/17);
  else if(r>85&&t>=80&&t<=87)h+=((r-85)/10)*((87-t)/5);
 }
 return Math.round((h-32)*5/9);
}
function heatBand(v){
 if(v===null||!Number.isFinite(v))return null;
 return v>=52?'Extreme danger':v>=42?'Danger':v>=33?'Extreme caution':v>=27?'Caution':'Below caution threshold';
}
function condition(code){
 const s=String(code||'').split('_')[0];
 if(s==='clearsky')return 'Clear';
 if(s==='fair')return 'Mostly clear';
 if(s==='partlycloudy')return 'Partly cloudy';
 if(s==='cloudy')return 'Cloudy';
 if(s==='fog')return 'Fog';
 if(s.includes('thunder'))return 'Thunderstorms';
 if(s.includes('rain'))return s.includes('heavy')?'Heavy rain':s.includes('light')?'Light rain':'Rain';
 if(s.includes('snow'))return 'Snow';
 if(s.includes('sleet'))return 'Sleet';
 return 'Forecast';
}
function normalize(data,now,checkedAt=now){
 const props=data?.properties,updated=Date.parse(props?.meta?.updated_at);
 if(!Number.isFinite(updated)||updated>now+300000||now-updated>36*3600000)throw Error('Invalid or outdated model run');
 const rows=(Array.isArray(props.timeseries)?props.timeseries:[]).map(row=>{
  const time=Date.parse(row.time),d=row.data?.instant?.details||{},next=row.data?.next_1_hours;
  const temperature=number(d.air_temperature,-70,60),humidity=number(d.relative_humidity,0,100);
  if(!Number.isFinite(time)||temperature===null||humidity===null)return null;
  return {time:new Date(time).toISOString(),temperature,humidity,heatIndex:heatIndex(temperature,humidity),windKph:number(d.wind_speed,0,150)===null?null:Math.round(d.wind_speed*3.6),rainMm:number(next?.details?.precipitation_amount,0,500),condition:condition(next?.summary?.symbol_code||row.data?.next_6_hours?.summary?.symbol_code)};
 }).filter(Boolean).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 const current=rows.filter(r=>Date.parse(r.time)<=now&&now-Date.parse(r.time)<=90*60000).at(-1)||rows.find(r=>Date.parse(r.time)>=now&&Date.parse(r.time)-now<=90*60000);
 if(!current)throw Error('No applicable forecast');
 return {...current,validAt:current.time,heatBand:heatBand(current.heatIndex),modelUpdatedAt:new Date(updated).toISOString(),checkedAt:new Date(checkedAt).toISOString(),hourly:rows.filter(r=>Date.parse(r.time)>Math.max(now,Date.parse(current.time))).slice(0,6),source:'MET Norway'};
}
function createWeatherCache({fetchImpl=global.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let starts=[],blockedUntil=0;
 function result(entry,t,stale=false){
  if(!entry?.raw||t-entry.checkedAt>STALE&&stale)return {status:'unavailable'};
  try{return {status:stale?'stale':'live',weather:normalize(entry.raw,t,entry.checkedAt)};}catch{return {status:'unavailable'};}
 }
 return async function get(lat,lon){
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180)return {status:'unavailable'};
  const coordinate=Number(lat).toFixed(3)+','+Number(lon).toFixed(3);
  const old=cache.get(coordinate),t=now();
  if(old&&old.retryAt>t)return result(old,t,old.failed);
  if(pending.has(coordinate))return pending.get(coordinate);
  if(t<blockedUntil)return result(old,t,true);
  starts=starts.filter(s=>s>t-1000);
  if(starts.length>=8||pending.size>=16)return result(old,t,true);
  // Never evict a forecast before its provider expiry. Bound memory by declining new locations when full.
  for(const [k,v] of cache)if(v.retryAt<=t&&t-v.checkedAt>24*3600000)cache.delete(k);
  if(!old&&cache.size>=MAX)return {status:'unavailable'};
  starts.push(t);
  const request=(async()=>{
   try{
    const url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');const [a,b]=coordinate.split(',');url.searchParams.set('lat',a);url.searchParams.set('lon',b);
    const headers={'User-Agent':'Attendigo/5.1 https://github.com/sajetarios/student-attendance-tracker','Accept':'application/json'};
    if(old?.lastModified)headers['If-Modified-Since']=old.lastModified;
    const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(6000),redirect:'error'});
    const expiry=Date.parse(response.headers?.get('expires')||'');
    const retryAt=Math.max(now()+TTL,Number.isFinite(expiry)?expiry:0);
    if(response.status===429||response.status===403){
     const retry=response.headers?.get('retry-after'),delay=Number(retry);
     blockedUntil=Math.max(now()+30*60000,retryAt,retry&&Number.isFinite(delay)?now()+delay*1000:Date.parse(retry)||0);
     throw Error('Provider throttled');
    }
    if(response.status===203)console.warn('MET Norway forecast endpoint is deprecated');
    const raw=response.status===304?old?.raw:response.ok?await response.json():null;
    if(!raw)throw Error('Weather provider unavailable');
    const checkedAt=now();normalize(raw,checkedAt,checkedAt);
    const entry={raw,checkedAt,retryAt,lastModified:response.headers?.get('last-modified')||old?.lastModified||'',failed:false};
    cache.set(coordinate,entry);return result(entry,checkedAt);
   }catch{
    const entry={...old,checkedAt:old?.checkedAt||now(),retryAt:Math.max(now()+RETRY,blockedUntil),failed:true};
    cache.set(coordinate,entry);return result(entry,now(),true);
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
    if(entry.rows.length){if(campusCache.size>=MAX)campusCache.delete(campusCache.keys().next().value);campusCache.set(school,entry);}else{campusCache.delete(school);}
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
module.exports={heatIndex,heatBand,normalize,createWeatherCache,registerSchoolWeatherRoutes};
