'use strict';
const path=require('node:path');
let rendering=false;
async function renderLocatorPreview(pdf){
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
  const viewport=page.getViewport({scale:1.65});
  const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
  if(width*height>2500000)throw Error('Unexpected Locator Slip dimensions.');
  canvas=createCanvas(width,height);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
  return canvas.toBuffer('image/png');
 }finally{
  try{if(task)await task.destroy();}finally{rendering=false;if(canvas){canvas.width=1;canvas.height=1;}}
 }
}
module.exports={renderLocatorPreview};
