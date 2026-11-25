'use strict';
const path=require('node:path');
let rendering=false;
async function renderLocatorPage(pdf,print=false){
 if(rendering){const e=Error('Another Locator Slip preview is being prepared. Please retry.');e.code='PREVIEW_BUSY';throw e;}
 rendering=true;
 let task,canvas;
 try{
  const {createCanvas}=require('@napi-rs/canvas');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root=path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),'../..');
  task=pdfjs.getDocument({data:new Uint8Array(pdf),standardFontDataUrl:path.join(root,'standard_fonts')+path.sep,cMapUrl:path.join(root,'cmaps')+path.sep,cMapPacked:true,wasmUrl:path.join(root,'wasm')+path.sep,isEvalSupported:false,verbosity:0});
  const doc=await task.promise;
  if(doc.numPages!==1)throw Error('Unexpected Locator Slip page count.');
  const page=await doc.getPage(1);
  const original=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:print?300/72:1.65});
  const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
  if(width*height>(print?9000000:2500000))throw Error('Unexpected Locator Slip dimensions.');
  canvas=createCanvas(width,height);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
  if(!print)return canvas.toBuffer('image/png');
  // Render the same official page at 300 dpi; use small row batches to bound memory.
  const ctx=canvas.getContext('2d'),rgb=Buffer.allocUnsafe(width*height*3);
  for(let y=0;y<height;y+=32){
   const rows=Math.min(32,height-y),rgba=ctx.getImageData(0,y,width,rows).data;
   let at=y*width*3;
   for(let i=0;i<rgba.length;i+=4){
    const alpha=rgba[i+3];
    rgb[at++]=Math.round((rgba[i]*alpha+255*(255-alpha))/255);
    rgb[at++]=Math.round((rgba[i+1]*alpha+255*(255-alpha))/255);
    rgb[at++]=Math.round((rgba[i+2]*alpha+255*(255-alpha))/255);
   }
  }
  return require('./locator-slip-print-pdf').buildPrintPdf({rgb,width,height,pageWidth:original.width,pageHeight:original.height});
 }finally{
  try{if(task)await task.destroy();}finally{rendering=false;if(canvas){canvas.width=1;canvas.height=1;}}
 }
}
const renderLocatorPreview=pdf=>renderLocatorPage(pdf,false);
const renderLocatorPrintPdf=pdf=>renderLocatorPage(pdf,true);
module.exports={renderLocatorPreview,renderLocatorPrintPdf};
