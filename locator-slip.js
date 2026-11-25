'use strict';
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const TEMPLATE_SHA='6d340f2f6548c7736ec40cc8c2cc0f0e902d77f713da3ef93f721b92e66745c9';
const path=require('node:path');
const TEMPLATE_PATH=path.join(__dirname,'templates','Revised-Annex-E.pdf');
const verify=bytes=>{if(!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==TEMPLATE_SHA)throw Error('Official Locator Slip template failed integrity verification.');return bytes;};
let verifiedTemplate;
async function getTemplate(pool){
 if(verifiedTemplate)return verifiedTemplate;
 // Prefer a verified local master (one shared deployment asset).
 const local=process.env.ATTENDIGO_LOCATOR_TEMPLATE_PATH||TEMPLATE_PATH;
 try{verifiedTemplate=verify(await fs.readFile(local));return verifiedTemplate;}catch(e){if(e.code!=='ENOENT')throw e;}
 // A single immutable master can be provisioned by authorized staff once.
 if(pool){
  const result=await pool.query("SELECT pdf_bytes FROM shared_locator_slip_template WHERE template_id='DEPED_REVISED_ANNEX_E'");
  if(result.rowCount){verifiedTemplate=verify(result.rows[0].pdf_bytes);return verifiedTemplate;}
 }
 const error=Error('The official Locator Slip master has not been installed. Upload the original DepEd Revised Annex E PDF once, then try again.');
 error.code='LOCATOR_TEMPLATE_REQUIRED';throw error;
}
async function installTemplate(pool,bytes){
 const verified=verify(bytes);
 await pool.query("INSERT INTO shared_locator_slip_template(template_id,pdf_bytes) VALUES('DEPED_REVISED_ANNEX_E',$1) ON CONFLICT(template_id) DO NOTHING",[verified]);
 // Re-read and verify the immutable stored master before allowing downloads.
 verifiedTemplate=null;return getTemplate(pool);
}
const clean=v=>String(v??'').trim().replace(/\s+/gu,' ');
const winAnsi=new Map([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"].map((c,i)=>[c,[128,130,131,132,133,134,135,136,137,138,139,140,142,145,146,147,148,149,150,151,152,153,154,155,156,158,159][i]]));
function hex(value){return '<'+[...value].map(c=>{const n=c.codePointAt(0),v=winAnsi.get(c)??((n>=32&&n<=126||n>=160&&n<=255)?n:null);if(v===null)throw Error('A form field contains a character not supported by the official print font.');return v.toString(16).padStart(2,'0');}).join('')+'>';}
function width(value,size){return [...value].reduce((n,c)=>n+(/[ilI.,' :;!|]/.test(c)?0.37:/[mwMW@%&]/.test(c)?1.02:/[A-Z]/.test(c)?0.79:0.66),0)*size;}
function wrap(value,size,maxWidth){const lines=[];let line='';for(const word of value.split(' ')){if(width(word,size)>maxWidth)return null;const next=line?line+' '+word:word;if(width(next,size)>maxWidth){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);return lines;}
function fit(value,field,maxLines){value=clean(value);if(!value)throw Error('Complete '+field+' before printing the Locator Slip.');hex(value);for(let size=10;size>=8;size-=0.5){const lines=wrap(value,size,305);if(lines&&lines.length<=maxLines)return {size,lines};}throw Error(field+' is too long for the official Locator Slip. Use a concise entry and provide supporting details in an attachment.');}
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
const dateFormat=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
const timeFormat=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
function buildLocatorSlip(template,data){verify(template);const start=new Date(data.startsAt),end=new Date(data.endsAt);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||dayFormat.format(start)!==dayFormat.format(end))throw Error('The Locator Slip is for same-day official travel. Use the applicable Travel Authority for multi-day travel.');
 const commands=['q','0 g'];
 function field(value,label,y,maxLines=1){const {size,lines}=fit(value,label,maxLines);for(let i=0;i<lines.length;i++)commands.push('BT /OBF '+size+' Tf 1 0 0 1 212 '+(841.68-y-i*(size+1)).toFixed(2)+' Tm '+hex(lines[i])+' Tj ET');}
 field(data.staffName,'employee name',241);field(data.position,'position/designation',254.2);field(data.schoolName,'permanent station',267.4);field(data.purpose,'purpose of travel',280,3);field(dateFormat.format(start)+' | '+timeFormat.format(start)+' - '+timeFormat.format(end),'date and time',332.8);field(data.destination,'destination',346);
 commands.push('0 G 1.2 w 222.5 525.8 m 225.3 522.8 l 230.1 529.9 l S','Q');
 const stream=commands.join('\n')+'\n';
 // Exact verified Annex E page: append only an overlay and a standard print font.
 // Original content streams and offsets remain intact. The obsolete linearization hint is disabled in the output copy.
 const objects=[[115,'<< /Contents [117 0 R 118 0 R 119 0 R 120 0 R 121 0 R 122 0 R 123 0 R 124 0 R 157 0 R] /CropBox [0 0 595.44 841.68] /MediaBox [0 0 595.44 841.68] /Parent 111 0 R /Resources << /ExtGState << /GS0 140 0 R >> /Font << /C2_0 145 0 R /TT0 147 0 R /TT1 149 0 R /TT2 151 0 R /TT3 153 0 R /TT4 155 0 R /OBF 158 0 R >> /ProcSet [/PDF /Text /ImageC] /XObject << /Im0 138 0 R >> >> /Rotate 0 /StructParents 0 /Tabs /S /Type /Page >>'],[157,'<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream'],[158,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']];
 let tail='\n';const offsets=[];for(const [id,body] of objects){offsets.push([id,template.length+Buffer.byteLength(tail)]);tail+=id+' 0 obj\n'+body+'\nendobj\n';}
 const xref=template.length+Buffer.byteLength(tail);tail+='xref\n';for(const [id,offset] of offsets)tail+=id+' 1\n'+String(offset).padStart(10,'0')+' 00000 n \n';
 tail+='trailer\n<< /Size 159 /Root 114 0 R /Info 112 0 R /Prev 116 /ID [<BC8664CF562EAE4FA854D272CD274893><AC92A78F368A9146A17A3C957C7C9C20>] >>\nstartxref\n'+xref+'\n%%EOF\n';
 // Appending a revision invalidates the original fast-web-view file-length hint.
 // Disable it in the generated copy without changing any object offsets or stored master.
 const prefix=Buffer.from(template);
 const hint=prefix.indexOf('/Linearized');
 if(hint<0||hint>128)throw Error('Unexpected official PDF header.');
 prefix.write('/ObOrigHint',hint,'ascii');
 return Buffer.concat([prefix,Buffer.from(tail,'ascii')]);
}
module.exports={getTemplate,installTemplate,buildLocatorSlip,TEMPLATE_SHA};
