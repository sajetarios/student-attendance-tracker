'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const JSZip=require(require.resolve('jszip',{paths:[require.resolve('exceljs')]}));
const {MASTER}=require('../sf2-master-export');
test('actual sanitized TUVERA master is present and preserves original layout without personal source data',async()=>{
 const bytes=await fs.readFile(MASTER);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'5c258a4e41cd5e40ee294da78c7b3255b25770ca1e947af37fd9ea33be4e7d44');
 const zip=await JSZip.loadAsync(bytes);
 const ws=await zip.file('xl/worksheets/sheet1.xml').async('string');
 assert.match(ws,/<mergeCells count="257">/);
 assert.match(ws,/<pageSetup[^>]*paperSize="9"[^>]*orientation="landscape"/);
 for(const p of ['xl/media/image1.png','xl/media/image2.png','xl/drawings/drawing1.xml','xl/styles.xml'])assert.ok(zip.file(p),p);
 for(const p of Object.keys(zip.files))assert.ok(!/sharedStrings|comments|sheet2\.xml|docProps|calcChain/i.test(p),p);
 for(const a of ['G6','G7','AE140','AE145','B13','B64','M13','AQ9','AK119','AL119']){
  const c=ws.match(new RegExp('<c\\b[^>]*\\br="'+a+'"[^>]*(?:/>|>[\\s\\S]*?<\\/c>)'));
  assert.ok(c,a);assert.ok(!/<(?:v|is|f)\b/.test(c[0]),a+' must be empty in master');
 }
});
