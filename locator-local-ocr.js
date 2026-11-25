'use strict';
// Local optional Tesseract executable; never sends a school document to an external service.
const {spawn}=require('node:child_process');
const {labelHints}=require('./locator-recognition');
let running=false;
async function recognizePng(png,width,height){
 if(running)return {hints:[],source:'ocr-busy'};
 running=true;
 try{
  const output=await new Promise((resolve,reject)=>{
   const child=spawn('tesseract',['stdin','stdout','-l','eng','--psm','11','tsv'],{stdio:['pipe','pipe','ignore'],windowsHide:true});
   let chunks=[],length=0,done=false;
   const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v);};
   const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('OCR timeout'));},12000);
   child.on('error',e=>finish(e));child.stdin.on('error',()=>{});child.stdout.on('data',b=>{length+=b.length;if(length>250000){child.kill('SIGKILL');finish(Error('OCR output limit'));}else chunks.push(b);});
   child.on('close',code=>code===0?finish(null,Buffer.concat(chunks).toString('utf8')):finish(Error('OCR failed')));
   child.stdin.end(png);
  });
  const items=[];
  for(const row of output.split('\n').slice(1,1500)){const c=row.split('\t');if(c.length<12||c[0]!=='5'||Number(c[10])<75)continue;const [x,y,w,h]=c.slice(6,10).map(Number);items.push({text:c.slice(11).join(' '),rect:[x/width,y/height,w/width,h/height]});}
  return {hints:labelHints(items),source:'local-ocr'};
 }catch(e){return {hints:[],source:e.code==='ENOENT'?'ocr-unavailable':'ocr-failed'};}finally{running=false;}
}
module.exports={recognizePng};
