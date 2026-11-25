'use strict';
// Geometry-only assistant for the explicitly confirmed common seven-row form.
// It does not read labels or determine official division identity.
(function(root){
 function suggest(image){
  const {width:w,height:h,data:d}=image;
  if(!w||!h||!d||w*h>4000000)return null;
  const dark=(x,y)=>{const i=(y*w+x)*4;return d[i+3]>100&&Math.max(d[i],d[i+1],d[i+2])<210;};
  const lines=[];
  for(let y=Math.floor(h*.08);y<h*.85;y++){
   let start=-1,last=-1,best=null;
   for(let x=0;x<w;x++){
    if(dark(x,y)){if(start<0)start=x;last=x;}
    else if(start>=0&&x-last>Math.max(2,Math.round(w*.003))){
     if(!best||last-start>best.r-best.l)best={l:start,r:last};start=-1;
    }
   }
   if(start>=0&&(!best||last-start>best.r-best.l))best={l:start,r:last};
   if(!best||best.r-best.l<w*.55)continue;
   const prev=lines.at(-1);
   if(prev&&y-prev.end<=Math.max(2,Math.round(h*.003))&&Math.abs(prev.l-best.l)<w*.025&&Math.abs(prev.r-best.r)<w*.025){prev.end=y;prev.y=(prev.start+y)/2;}
   else lines.push({start:y,end:y,y,...best});
  }
  const candidates=[];
  for(let i=0;i+7<lines.length;i++){
   const g=lines.slice(i,i+8),l=g[0].l,r=g[0].r;
   if(g.some(q=>Math.abs(q.l-l)>w*.025||Math.abs(q.r-r)>w*.025))continue;
   const heights=g.slice(1).map((q,j)=>q.y-g[j].y),unit=(heights[0]+heights[1]+heights[2]+heights[4]+heights[5])/5;
   if(unit<h*.009||unit>h*.045||[0,1,2,4,5].some(j=>heights[j]<unit*.65||heights[j]>unit*1.45)||heights[3]<unit*1.45||heights[3]>unit*4||heights[6]<unit*.75||heights[6]>unit*2.1)continue;
   // A continuous vertical separator must span the input table.
   let bestX=0,bestScore=0;
   for(let x=Math.ceil(l+(r-l)*.18);x<=l+(r-l)*.5;x++){
    let score=0;for(let y=Math.ceil(g[0].y);y<=g[7].y;y++)if(dark(x,y))score++;
    if(score>bestScore){bestScore=score;bestX=x;}
   }
   if(bestScore<(g[7].y-g[0].y)*.72)continue;
   const mapping={};
   for(const [key,j] of [['name',0],['position',1],['station',2],['purpose',3],['event',5],['destination',6]]){
    const x=bestX+Math.max(3,w*.006),right=r-Math.max(3,w*.006),top=g[j].end+Math.max(1,h*.001),bottom=g[j+1].start-Math.max(1,h*.001);
    if(bottom-top<h*.009||right-x<w*.15)break;
    let ink=0,total=0;
    for(let y=Math.ceil(top+1);y<bottom-1;y++)for(let xx=Math.ceil(x+1);xx<right-1;xx++){total++;if(dark(xx,y))ink++;}
    if(!total||ink/total>.012)break;
    mapping[key]=[x/w,top/h,(right-x)/w,(bottom-top)/h];
   }
   if(Object.keys(mapping).length===6)candidates.push(mapping);
  }
  return candidates.length===1?candidates[0]:null;
 }
 function point(bounds,x,y){return [Math.max(0,Math.min(1,(x-bounds.left)/bounds.width)),Math.max(0,Math.min(1,(y-bounds.top)/bounds.height))];}
 function rectangle(a,b){return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])];}
 const api={suggest,point,rectangle};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.AttendigoLocatorSuggest=api;
})(typeof globalThis==='object'?globalThis:this);
