'use strict';
// Preview-only school administrator pilot. No files, mappings or employee
// data are persisted and no live template selection is changed.
const MAX_BYTES=2*1024*1024;
const fields=Object.freeze([
 ['name','Employee name','MARIA A. DELA CRUZ-SANTOS',true],
 ['position','Position / designation','Teacher III',true],
 ['station','Permanent station / school','Sample National High School',true],
 ['purpose','Purpose of travel','Submission of school reports and attendance at a division meeting',true],
 ['destination','Destination','Schools Division Office',true],
 ['event','Date and time of travel','Nov 26, 2026 | 8:00 AM – 12:00 PM',true],
 ['business','Official Business checkbox','✓',false],
 ['filed','Date of filing','Nov 25, 2026',false],
 ['region','Region','Region XI',false],
 ['division','Division','Sample Schools Division',false],
 ['head','School Head name','JUAN A. DELA CRUZ, EdD',false],
 ['headPosition','School Head designation','Principal II',false]
]);
function parseUpload(value){
 if(typeof value!=='string'||value.length>Math.ceil(MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Choose a blank PDF of up to 2 MB.');
 const b=Buffer.from(value,'base64');
 if(!b.length||b.length>MAX_BYTES||b.toString('base64')!==value||b.subarray(0,5).toString()!=='%PDF-')throw Error('Choose a valid PDF file.');
 return b;
}
function validateMapping(mapping){
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).length>fields.length)throw Error('Complete the guided setup.');
 const valid=Object.create(null);
 for(const key of Object.keys(mapping)){
  if(!fields.some(f=>f[0]===key))throw Error('Unknown form field.');
  const r=mapping[key];
  if(!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite))throw Error('Select a valid blank space.');
  const [x,y,w,h]=r;
  if(x<0||y<0||w<(key==='business'?.005:.012)||h<(key==='business'?.004:.009)||x+w>1.000001||y+h>1.000001)throw Error('Select a larger space inside the page.');
  for(const b of Object.values(valid)){
   if(x<b[0]+b[2]&&x+w>b[0]&&y<b[1]+b[3]&&y+h>b[1])throw Error('Two selected spaces overlap. Adjust their placement.');
  }
  valid[key]=r;
 }
 for(const [key,label,,required] of fields)if(required&&!valid[key])throw Error('Select the space for '+label+'.');
 return valid;
}
function fieldError(key,label,reason){const e=Error(label+': '+reason);e.code='LOCATOR_FIELD_INVALID';e.field=key;return e;}
function overlay(ctx,width,height,mapping,values=null){
 for(const [key,label,sample] of fields){
  const value=values?String(values[key]??'').trim():sample;
  if(!mapping[key])continue;
  if(!value)throw fieldError(key,label,'complete this field before printing.');
  const [x,y,w,h]=mapping[key].map((v,i)=>v*(i%2===0?width:height));
  const pad=Math.min(w,h)*.08;
  // Conservative occupied-space check, using interior pixels to avoid cell borders.
  // This detects many printed labels but is not OCR or a compliance check.
  const inset=Math.max(1,Math.floor(Math.min(w,h)*.12));
  const bx=Math.ceil(x+inset),by=Math.ceil(y+inset),bw=Math.floor(w-2*inset),bh=Math.floor(h-2*inset);
  if(bw<1||bh<1)throw fieldError(key,label,'select a larger blank space.');
  const rgba=ctx.getImageData(bx,by,bw,bh).data;
  let dark=0;
  for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>100&&Math.min(rgba[i],rgba[i+1],rgba[i+2])<190)dark++;
  if(dark/(bw*bh)>.018)throw fieldError(key,label,'the selected space contains printed content. Select an empty area.');
  if(key==='business'){
   // This renderer is used exclusively by the OB request workflow.
   // Draw a compact centered tick in the blank interior, not over the label.
   if(value!=='✓')throw fieldError(key,label,'invalid Official Business mark.');
   if(w>width*.10||h>height*.035)throw fieldError(key,label,'select only the empty Official Business checkbox, not its label.');
   const size=Math.min(w,h)*.68,cx=x+w/2,cy=y+h/2;
   ctx.save();ctx.strokeStyle='#111111';ctx.lineWidth=Math.max(1,size*.13);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cx-size*.40,cy);ctx.lineTo(cx-size*.12,cy+size*.30);ctx.lineTo(cx+size*.44,cy-size*.32);ctx.stroke();ctx.restore();continue;
  }
  let lines=null,fs;
  for(fs=width/595*12;fs>=width/595*8;fs-=width/595*.5){
   ctx.font=fs+'px Arial, sans-serif';
   const rows=[];let row='';
   for(const word of value.split(' ')){
    const next=row?row+' '+word:word;
    if(row&&ctx.measureText(next).width>w-2*pad){rows.push(row);row=word;}else row=next;
   }
   if(row)rows.push(row);
   if(rows.length*fs*1.2<=h-2*pad&&rows.every(s=>ctx.measureText(s).width<=w-2*pad)){lines=rows;break;}
  }
  if(!lines)throw fieldError(key,label,'the text does not fit. Select a larger space.');
  ctx.fillStyle='#111111';ctx.textAlign='left';ctx.textBaseline='middle';
  lines.forEach((s,i)=>ctx.fillText(s,x+pad,y+(h-lines.length*fs*1.2)/2+fs*(i*1.2+.6)));
 }
 // Mark every populated export as a sample; never present it as authorization.
 if(values)return;
 ctx.save();ctx.translate(width/2,height/2);ctx.rotate(-Math.PI/5);
 ctx.globalAlpha=.20;ctx.fillStyle='#ac1616';ctx.font='bold '+Math.floor(width*.035)+'px Arial, sans-serif';
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('SAMPLE – NOT FOR OFFICIAL USE',0,0);ctx.restore();
}

module.exports={fields,validateMapping,overlay,fieldError};
