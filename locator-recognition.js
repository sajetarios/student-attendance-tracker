'use strict';
const catalog=require('./public/locator-field-library');
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const aliases={
 name:['name','employee name','name of employee','name of personnel','name of official employee','name of official or employee','name of requesting employee'],
 position:['position','designation','position designation','position title','official designation'],
 station:['permanent station','place of assignment','station','office station','school station','permanent place of assignment'],
 schoolName:['school name','name of school'],
 purpose:['purpose','purpose of travel','purpose of trip','purpose of visit','nature of activity','purpose activity','purpose of official travel','purpose of official business'],
 destination:['destination','place of destination','place to be visited','office to be visited','destination office'],
 event:['date and time','date time','date and time of travel','date and time of official business','scheduled date and time'],
 travelDate:['date of travel','travel date','date of official business','scheduled date'],
 departTime:['scheduled departure','scheduled departure time','expected time of departure','expected departure time','planned departure time','scheduled start time','time of departure scheduled'],
 returnTime:['scheduled return','scheduled return time','expected time of return','expected return time','planned return time','scheduled end time','time of return scheduled'],
 startDateTime:['scheduled start date and time','scheduled departure date and time','expected date and time of departure'],
 endDateTime:['scheduled end date and time','scheduled return date and time','expected date and time of return'],
 timeRange:['scheduled time range','scheduled time','time range','time of official business'],
 filed:['date filed','date of filing','date of submission','date of application'],
 head:['name of school head','school head name','name of approving official'],
 headPosition:['school head designation','position of school head','designation of school head'],
 business:['official business','ob official business','official business ob'],
 officialTime:['official time','ot official time','official time ot']
};
const lookup=new Map(Object.entries(aliases).flatMap(([key,labels])=>labels.map(s=>[s,key])));
const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=1.001&&r[1]+r[3]<=1.001;
function labelHints(items){
 // Merge only tightly adjacent text runs on the same baseline. Never match a substring
 // of a label such as "actual time of return" or "employee signature".
 const sorted=items.filter(t=>validRect(t.rect)&&normalize(t.text)).sort((a,b)=>a.rect[1]-b.rect[1]||a.rect[0]-b.rect[0]).slice(0,1000);
 const lines=[];
 for(const item of sorted){
  const [x,y,w,h]=item.rect;let line=lines.find(l=>Math.abs(l.y+l.h/2-y-h/2)<Math.min(l.h,h)*.55);
  if(!line){line={y,h,items:[]};lines.push(line);}line.items.push(item);
 }
 const out=[];
 for(const line of lines){
  const chunks=[];let chunk=null;
  for(const item of line.items.sort((a,b)=>a.rect[0]-b.rect[0])){
   const r=item.rect;
   if(chunk&&r[0]-(chunk.rect[0]+chunk.rect[2])<=Math.max(.006,Math.min(chunk.rect[3],r[3])*.6)){
    const a=chunk.rect,x=Math.min(a[0],r[0]),y=Math.min(a[1],r[1]);chunk.rect=[x,y,Math.max(a[0]+a[2],r[0]+r[2])-x,Math.max(a[1]+a[3],r[1]+r[3])-y];chunk.text+=' '+item.text;
   }else{chunk={text:item.text,rect:r.slice()};chunks.push(chunk);}
  }
  for(const chunk of chunks){const key=lookup.get(normalize(chunk.text));if(key&&validRect(chunk.rect))out.push({key,rect:chunk.rect});}
 }
 // Store no PDF text, only catalog keys and bounded geometry.
 return out.slice(0,80);
}
function suggest(image,hints){
 const {width:w,height:h,data:d}=image;
 if(!w||!h||w*h>4000000||!d||!Array.isArray(hints))return {mapping:{},matches:[]};
 const stride=w+1,integral=new Uint32Array(stride*(h+1));
 for(let y=0;y<h;y++){let sum=0;for(let x=0;x<w;x++){const i=(y*w+x)*4;sum+=d[i+3]>100&&Math.max(d[i],d[i+1],d[i+2])<200?1:0;integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}}
 const ink=(x,y,r,b)=>{x=Math.max(0,Math.min(w,Math.round(x)));r=Math.max(0,Math.min(w,Math.round(r)));y=Math.max(0,Math.min(h,Math.round(y)));b=Math.max(0,Math.min(h,Math.round(b)));return r>x&&b>y?(integral[b*stride+r]-integral[y*stride+r]-integral[b*stride+x]+integral[y*stride+x])/((r-x)*(b-y)):1;};
 const result={},matches=[];
 const pad=Math.max(2,Math.round(w*.003));
 const bounded=hints.filter(t=>catalog.descriptor(t.key)&&validRect(t.rect)).slice(0,80);
 function lineY(y,dir,left,right,limit){for(let i=Math.round(y);i>0&&i<h-1&&Math.abs(i-y)<=limit;i+=dir)if(ink(left,i,right,i+1)>.7)return i;return null;}
 function lineX(x,dir,top,bottom,limit){for(let i=Math.round(x);i>0&&i<w-1&&Math.abs(i-x)<=limit;i+=dir)if(ink(i,top,i+1,bottom)>.7)return i;return null;}
 for(const hint of bounded){
  const {key,rect}=hint,[x,y,ww,hh]=rect.map((v,i)=>v*(i%2===0?w:h));
  const cy=y+hh/2;let chosen=null;
  if(catalog.checkbox(key)){
   // Require a real closed square adjacent to the printed checkbox label.
   const boxes=[];
   for(let side of [-1,1]){
    const lo=side<0?Math.max(1,Math.round(x-w*.065)):Math.round(x+ww+1),hi=side<0?Math.round(x-2):Math.min(w-1,Math.round(x+ww+w*.045));
    for(let bx=lo;bx<hi;bx++){
     for(let by=Math.max(1,Math.round(cy-h*.014));by<cy+h*.008;by++){
      for(let size=Math.max(5,Math.round(w*.009));size<=Math.round(w*.025);size++){
       if(bx+size>hi||by+size>=h||Math.abs(by+size/2-cy)>hh*.8)continue;
       if(ink(bx,by,bx+size,by+1)>.72&&ink(bx,by+size-1,bx+size,by+size)>.72&&ink(bx,by,bx+1,by+size)>.72&&ink(bx+size-1,by,bx+size,by+size)>.72&&ink(bx+2,by+2,bx+size-2,by+size-2)<.012){
        const b=[(bx+2)/w,(by+2)/h,(size-4)/w,(size-4)/h];if(b[2]>=.005&&b[3]>=.004&&!boxes.some(q=>overlap(q,b)))boxes.push(b);
       }
      }
     }
    }
   }
   if(boxes.length===1)chosen=boxes[0];
  }else{
   // Identify the actual row borders around this label and adjacent empty cell.
   const left=Math.max(1,x-pad),right=Math.min(w-1,x+ww+w*.12);
   const top=lineY(y-pad,-1,left,right,h*.055),bottom=lineY(y+hh+pad,1,left,right,h*.075);
   if(top!==null&&bottom!==null&&bottom-top>=h*.012){
    const separator=lineX(x+ww+pad,1,top+2,bottom-1,w*.3);
    const end=separator===null?null:lineX(separator+pad*2,1,top+2,bottom-1,w*.7);
    if(separator!==null&&end!==null&&end-separator>w*.055){
     const a=separator+pad,b=top+pad,c=end-pad,e=bottom-pad;
     if(c>a&&e>b&&ink(a,b,c,e)<.008)chosen=[a/w,b/h,(c-a)/w,(e-b)/h];
    }
   }
  }
  if(!chosen||Object.values(result).some(r=>overlap(r,chosen))||bounded.some(other=>overlap(chosen,other.rect))){matches.push({key,status:'review'});continue;}
  const dest=[key,...[2,3,4,5].map(i=>key+'__'+i)].find(k=>!result[k]);if(!dest)continue;
  result[dest]=chosen;matches.push({key:dest,status:'suggested'});
 }
 return {mapping:result,matches};
}
module.exports={labelHints,suggest,normalize};
