'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const portal=fs.readFileSync(path.join(__dirname,'../public/portal.js'),'utf8');
test('roster includes distinct LIS SF1 fields for school admin and teacher only',()=>{
 const section=server.slice(server.indexOf("app.get('/api/students'"),server.indexOf("app.get('/api/students'" )+5200);
 for(const col of ['s.lrn','s.father_name','s.mother_maiden_name','s.sf1_guardian_name','s.birth_date','s.sf1_address'])assert.ok(section.includes(col),col);
 assert.match(section,/req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER'/);
 assert.match(section,/isGateKeeper\) return res.status\(403\)/);
});
test('student Actions show LRN and separately labeled family facts',()=>{
 for(const label of ['LRN',"Father's name","Mother's maiden name",'Guardian (if not parent)','Primary parent / guardian','Contact number','Birth date','Address'])assert.ok(portal.includes(label),label);
 assert.match(portal,/SF1 family names do not automatically designate a primary guardian/);
});
