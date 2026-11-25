'use strict';
const {deflateSync}=require('node:zlib');

// A conventional single-page PDF, without incremental revisions, linearization,
// transparency, embedded fonts, or external resources. Lossless RGB image.
function buildPrintPdf({rgb,width,height,pageWidth,pageHeight}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>9000000||
 !Buffer.isBuffer(rgb)||rgb.length!==width*height*3||
 !Number.isFinite(pageWidth)||!Number.isFinite(pageHeight)||pageWidth<=0||pageHeight<=0)throw Error('Invalid print page.');
 const chunks=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];
 let length=chunks[0].length;
 const push=v=>{const b=Buffer.isBuffer(v)?v:Buffer.from(v,'ascii');chunks.push(b);length+=b.length;};
 const object=(id,body,stream)=>{offsets[id]=length;push(id+' 0 obj\n'+body);if(stream){push('\nstream\n');push(stream);push('\nendstream');}push('\nendobj\n');};
 const w=pageWidth.toFixed(4),h=pageHeight.toFixed(4);
 const image=deflateSync(rgb,{level:6});
 const drawing=Buffer.from('q\n'+w+' 0 0 '+h+' 0 0 cm\n/Im0 Do\nQ\n','ascii');
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+w+' '+h+'] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
 object(4,'<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length '+image.length+' >>',image);
 object(5,'<< /Length '+drawing.length+' >>',drawing);
 const xref=length;push('xref\n0 6\n0000000000 65535 f \n');
 for(let i=1;i<=5;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.concat(chunks);
}
module.exports={buildPrintPdf};
