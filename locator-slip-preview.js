'use strict';
const path=require('node:path');
let rendering=false;
function canvasPrintPdf(canvas,pageWidth,pageHeight){
  // Render the same official page at 300 dpi; use small row batches to bound memory.
 const width=canvas.width,height=canvas.height;
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
  return require('./locator-slip-print-pdf').buildPrintPdf({rgb,width,height,pageWidth,pageHeight});
}
async function renderLocatorPage(pdf,print=false,sealOnly=false){
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
  const scale=sealOnly?173/56.65:print?300/72:1.65;
  const viewport=page.getViewport({scale});
  const width=sealOnly?173:Math.ceil(viewport.width),height=sealOnly?173:Math.ceil(viewport.height);
  if(width*height>(print?9000000:2500000))throw Error('Unexpected Locator Slip dimensions.');
  canvas=createCanvas(width,height);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,...(sealOnly?{transform:[1,0,0,1,-269.19989*scale,-78.16043*scale]}:{}),background:'rgb(255,255,255)'}).promise;
  if(!print)return canvas.toBuffer('image/png');
  return canvasPrintPdf(canvas,original.width,original.height);
 }finally{
  try{if(task)await task.destroy();}finally{rendering=false;if(canvas){canvas.width=1;canvas.height=1;}}
 }
}
const renderLocatorPreview=pdf=>renderLocatorPage(pdf,false);
const renderLocatorPrintPdf=pdf=>renderLocatorPage(pdf,true);
async function renderMatiLocator(master,fields,print=false){
 // Crop the exact DepEd emblem from the checksum-verified original.
 const sealBytes=await renderLocatorPage(master,false,true);
 if(rendering){const e=Error('Another Locator Slip is being prepared. Please retry.');e.code='PREVIEW_BUSY';throw e;}
 rendering=true;let canvas;
 try{
  const {createCanvas,loadImage}=require('@napi-rs/canvas');
  const {W,H,drawMatiForm}=require('./mati-locator-slip');
  const scale=print?300/72:1.65;
  canvas=createCanvas(Math.ceil(W*scale),Math.ceil(H*scale));
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);
  drawMatiForm(ctx,fields,await loadImage(sealBytes));
  return print?canvasPrintPdf(canvas,W,H):canvas.toBuffer('image/png');
 }finally{rendering=false;if(canvas){canvas.width=1;canvas.height=1;}}
}
async function renderCentralLocator(pdf,mapping,print=false,values=null){
 if(rendering){const e=Error('Another Locator Slip is being prepared. Please retry.');e.code='PREVIEW_BUSY';throw e;}
 rendering=true;let task,canvas;
 try{
  const {createCanvas}=require('@napi-rs/canvas');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root=path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),'../..');
  task=pdfjs.getDocument({data:new Uint8Array(pdf),standardFontDataUrl:path.join(root,'standard_fonts')+path.sep,cMapUrl:path.join(root,'cmaps')+path.sep,cMapPacked:true,wasmUrl:path.join(root,'wasm')+path.sep,isEvalSupported:false,enableXfa:false,stopAtErrors:true,maxImageSize:9000000,verbosity:0});
  const doc=await task.promise;
  if(doc.numPages!==1)throw Error('Only one page is supported in this pilot.');
  const page=await doc.getPage(1),original=page.getViewport({scale:1});
  if(original.width<350||original.height<500||original.width>650||original.height>880||original.width>=original.height)throw Error('Use a single-page portrait PDF close to A4 or Letter size.');
  if((await page.getAnnotations()).length)throw Error('Use a flattened blank PDF without interactive fields or annotations.');
  const viewport=page.getViewport({scale:print?300/72:1.65});
  const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
  if(width*height>10000000)throw Error('Use a smaller portrait PDF.');
  canvas=createCanvas(width,height);
  const ctx=canvas.getContext('2d');
  await page.render({canvas,canvasContext:ctx,viewport,annotationMode:0,background:'rgb(255,255,255)'}).promise;
  if(mapping)require('./central-locator-renderer').overlay(ctx,width,height,mapping,values);
  return print?canvasPrintPdf(canvas,original.width,original.height):canvas.toBuffer('image/png');
 }finally{
  try{if(task)await task.destroy();}finally{rendering=false;if(canvas){canvas.width=1;canvas.height=1;}}
 }
}

module.exports={renderLocatorPreview,renderLocatorPrintPdf,renderMatiLocator,renderCentralLocator};
