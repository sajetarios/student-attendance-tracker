'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('School Identity reuses school-wide DTR signatory fields without duplicating them',()=>{
 const html=fs.readFileSync('public/portal.html','utf8');
 const js=fs.readFileSync('public/portal.js','utf8');
 for(const id of ['form48ApprovedBy','form48ApprovedPosition','form48VerifiedBy','form48VerifiedPosition','form48SaveSignatories'])assert.equal(html.split('id="'+id+'"').length,2,id);
 assert.match(html,/School Head Name/);
 assert.match(html,/School Head \/ Authorized Signatory/);
 assert.match(html,/id="schoolIdentitySignatoryHome"/);
 assert.match(js,/const useIdentitySignatories = admin && schoolEntitlements\?\.features\?\.custom_branding !== false/);
 assert.match(js,/signatoryHome\.append\(signatoryBlock\)/);
 assert.match(js,/signatoryHome\.after\(signatoryBlock\)/);
 assert.match(html,/id="form48SignatoryShortcut"/);
});
