'use strict';
// Reproduction of the supplied Mati Division reference photograph, not an
// official replacement PDF. The stored DepEd master remains unchanged.
const W=595.44,H=841.68;
const date=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
const time=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
const clean=v=>String(v??'').trim().replace(/\s+/gu,' ');
function documentIdentity(branding,defaults){
 return {layout:branding?.locatorSlipLayout==='MATI'?'MATI':'ANNEX_E',
  region:clean(branding?.region),division:clean(branding?.division),
  schoolHeadName:clean(defaults?.approvedBy),schoolHeadPosition:clean(defaults?.approvedPosition)};
}
function matiFields(data,identity){
 const start=new Date(data.startsAt),end=new Date(data.endsAt),filed=new Date(data.submittedAt);
 if(![start,end,filed].every(d=>Number.isFinite(+d))||end<=start||date.format(start)!==date.format(end))throw Error('Locator Slips require valid same-day official travel dates.');
 const fields={region:identity.region,division:identity.division,filed:date.format(filed),
  name:data.staffName,station:data.schoolName,position:data.position,purpose:data.purpose,
  destination:data.destination,event:date.format(start)+' | '+time.format(start)+' – '+time.format(end),
  head:identity.schoolHeadName,headPosition:identity.schoolHeadPosition};
 for(const key of Object.keys(fields)){fields[key]=clean(fields[key]);if(!fields[key])throw Error('Complete '+key+' in the employee profile, OB request or School Identity before printing.');}
 return fields;
}
function drawMatiForm(ctx,fields,seal){
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
 ctx.fillStyle='#000000';ctx.strokeStyle='#000000';ctx.lineWidth=1.05;
 const L=20,R=W-20,mid=195,half=(L+R)/2;
 const font=(size,bold=false,italic=false)=>{ctx.font=(italic?'italic ':'')+(bold?'bold ':'')+size+'px Arial, sans-serif';};
 const line=(x1,y1,x2,y2)=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();};
 function text(value,x,y,maxWidth,size=12,bold=false,align='left',italic=false){
  font(size,bold,italic);while(ctx.measureText(value).width>maxWidth&&size>8){size-=0.5;font(size,bold,italic);}
  if(ctx.measureText(value).width>maxWidth)throw Error('A Locator Slip field is too long. Use a concise entry and an attachment.');
  ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(value,x,y);
 }
 function wrap(value,x,top,width,height,size=12,bold=false){
  for(let n=size;n>=8;n-=0.5){
   font(n,bold);const lines=[];let row='';
   for(const word of value.split(' ')){const next=row?row+' '+word:word;if(ctx.measureText(next).width>width&&row){lines.push(row);row=word;}else row=next;}
   if(row)lines.push(row);
   if(lines.length*n*1.18>height||lines.some(v=>ctx.measureText(v).width>width))continue;
   ctx.textAlign='left';ctx.textBaseline='middle';const y=top+(height-lines.length*n*1.18)/2+n*.59;
   lines.forEach((v,i)=>ctx.fillText(v,x,y+i*n*1.18));return;
  }
  throw Error('A Locator Slip field is too long. Use a concise entry and an attachment.');
 }
 if(seal)ctx.drawImage(seal,0,0,seal.width,seal.height,W/2-27,22,54,54);
 text('Republic of the Philippines',W/2,92,500,17,false,'center');
 text('Department of Education',W/2,115,500,19,false,'center');
 text('LOCATOR SLIP',W/2,181,500,29,true,'center');
 const rows=[
  ['REGION',fields.region,22,true],['BUREAU/DIVISION/SCHOOL',fields.division,25,true],
  ['DATE OF FILING',fields.filed,24,false],['NAME',fields.name,30,true],
  ['PERMANENT STATION',fields.station,27,true],['POSITION/DESIGNATION',fields.position,25,false],
  ['PURPOSE',fields.purpose,34,false],['PLEASE CHECK',null,24,false],
  ['DESTINATION',fields.destination,32,false],['DATE AND TIME OF EVENT/\nTRANSACTION/MEETING',fields.event,31,false]];
 let y=218;
 for(const [label,value,h,bold] of rows){
  ctx.strokeRect(L,y,R-L,h);line(mid,y,mid,y+h);
  const labels=label.split('\n');labels.forEach((v,i)=>text(v,L+10,y+h/2+(i-(labels.length-1)/2)*11,mid-L-16,labels.length>1?10:12));
  if(value===null){const x=mid+10;ctx.strokeRect(x,y+5,23,14);line(x+4,y+12,x+9,y+16);line(x+9,y+16,x+19,y+7);text('Official Business',x+29,y+12,125,12);ctx.strokeRect(x+157,y+5,23,14);text('Official Time',x+185,y+12,R-x-190,12);}
  else wrap(value,mid+10,y+2,R-mid-18,h-4,bold?14:12,bold);
  y+=h;
 }
 const signH=114;ctx.strokeRect(L,y,R-L,signH);line(half,y,half,y+signH);
 text('Recommending Approval',L+10,y+12,half-L-20,14);
 text('Approved',half+10,y+12,R-half-20,14);
 // Left name and signature remain blank as requested. The photograph labels
 // this signature as the requesting official/employee, not the DH.
 line(L+25,y+65,half-25,y+65);
 text('Signature of Requesting Official / Employee',(L+half)/2,y+77,half-L-16,10,false,'center');
 line(half+25,y+47,R-25,y+47);
 text(fields.head,(half+R)/2,y+59,R-half-22,14,true,'center');
 text(fields.headPosition,(half+R)/2,y+76,R-half-22,11,false,'center');
 text('Date:',L+10,y+101,100,11);text('Date:',half+10,y+101,100,11);
 y+=signH;
 const bottom=805;ctx.strokeRect(L,y,R-L,bottom-y);
 text('CERTIFICATION',W/2,y+15,R-L-20,16,true,'center');
 wrap('This is to certify that the above employee appeared in this Office for the above purpose.',L+10,y+32,R-L-20,34,12);
 const sigY=bottom-55;
 line(L+12,sigY-8,L+225,sigY-8);line(L+245,sigY-8,L+400,sigY-8);line(L+420,sigY-8,R-12,sigY-8);
 text('Signature over printed name',L+12,sigY+5,220,10);text('Position',L+245,sigY+5,150,10);text('Date',L+420,sigY+5,100,10);
 text('(Note: This portion shall be filled out by the Official/ authorized personnel of the',L+10,bottom-25,R-L-20,11,true,'left',true);
 text('Office visited.)',L+10,bottom-12,R-L-20,11,true,'left',true);
 text('*The accomplished and signed Locator Slip shall serve as the authority to travel.',L,819,R-L,12);
}
module.exports={W,H,documentIdentity,matiFields,drawMatiForm};
