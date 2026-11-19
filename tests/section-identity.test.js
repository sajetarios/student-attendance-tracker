'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sectionKey,gradeKey,distance,isSimilar,inspectName}=require('../section-identity');

test('normalized identity blocks capitalization, punctuation, and whitespace variants',()=>{
 assert.equal(sectionKey(' SPJ Tuvera '),sectionKey('spj-TUVERA'));
 assert.equal(sectionKey('SPJ   Tuvera'),sectionKey('SPJ_Tuvera'));
 assert.equal(sectionKey('SPJ.Tuvera'),sectionKey('SPJ Tuvera'));
 assert.notEqual(sectionKey('SPJ Tuvera'),sectionKey('SPJ Abueva'));
});
test('similarity flags plausible typos and transposition without auto-matching all sections',()=>{
 assert.equal(distance('Tuvera','Tuv era'),0);
 assert.equal(distance('Tuvera','Tuvrea'),1);
 assert.equal(isSimilar('SPJ Tuvera','SPJ Tuvrea'),true);
 assert.equal(isSimilar('SPJ Tuvera','SPJ Abueva'),false);
 assert.equal(isSimilar('Rizal','Abueva'),false);
});
test('exact and similar suggestions are distinct and no records are merged',()=>{
 const records=[{sectionName:'SPJ Tuvera',active:true},{sectionName:'SPJ Abueva',active:true}];
 const exact=inspectName('SPJ-Tuvera',records);
 assert.equal(exact.exact[0].sectionName,'SPJ Tuvera');
 assert.equal(exact.similar.length,0);
 const typo=inspectName('SPJ Tuvrea',records);
 assert.equal(typo.exact.length,0);
 assert.equal(typo.similar[0].sectionName,'SPJ Tuvera');
 assert.deepEqual(records.map(x=>x.sectionName),['SPJ Tuvera','SPJ Abueva']);
 assert.equal(gradeKey(' Grade 8 '),'grade 8');
 assert.notEqual(gradeKey('Grade 8'),gradeKey('Grade 9'));
});
