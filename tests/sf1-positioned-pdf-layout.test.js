'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readLayoutPages}=require('../sf1-pdf-layout');
const {parseSf1PdfText}=require('../sf1-pdf-parser');
const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
const header=[
 item('School Form 1 (SF1) School Register',40,840),
 item('School Year: 2026-2027 Grade Level Grade 8 (Year)',40,810),
 item('LRN',58,760),item('NAME',104,760),item('SEX',260,760),item('BIRTH DATE',293,760)
];
test('multi-page SF1 PDF layout reconstructs wrapped learner names by physical columns',()=>{
 const page1={items:[...header,
  item('123456789012',40,728),item('DELA CRUZ, JUAN,',101,728),item('M',263,728),
  item('SANTOS',101,714),item('BIRTHDAY',300,715),
  item('123456789013',40,680),item('REYES, ANA,',101,680),item('F',263,680),
  item('MARIA',101,667)]};
 const page2={items:[
  item('123456789014',40,750),item('SANTOS, PEDRO,',101,750),item('M',263,750),
  item('LOPEZ',101,736)
 ]};
 const parsed=readLayoutPages([page1,page2],{gradeLevel:'Grade 8',schoolYear:'2026-2027'});
 assert.equal(parsed.learners.length,3);
 assert.deepEqual(parsed.learners.map(r=>r.fullName),[
  'JUAN SANTOS DELA CRUZ','ANA MARIA REYES','PEDRO LOPEZ SANTOS'
 ]);
 assert.deepEqual(parsed.learners.map(r=>r.sex),['MALE','FEMALE','MALE']);
 assert.ok(parsed.learners.every(r=>r.section==='Unassigned'&&r.parentMobile===''));
 assert.deepEqual(parsed.errors,[]);
});
test('SF1 PDF with scientific-notation LRNs must never manufacture missing digits',()=>{
 const page={items:[...header,
  item('1.2938E+11',40,728),item('DELA CRUZ, JUAN, SANTOS',101,728),item('M',263,728)
 ]};
 assert.throws(()=>readLayoutPages([page],{gradeLevel:'Grade 8'}),/scientific notation/);
});
test('SF1 PDF layout flags unreadable sex and does not silently import partial rows',()=>{
 const page={items:[...header,
  item('123456789012',40,728),item('DELA CRUZ, JUAN, SANTOS',101,728),
  item('123456789013',40,680),item('REYES, ANA, MARIA',101,680),item('F',263,680)
 ]};
 const parsed=readLayoutPages([page],{gradeLevel:'Grade 8'});
 assert.equal(parsed.learners.length,1);
 assert.equal(parsed.errors.length,2);
});
test('header tolerates Grade Level Grade 8, as shown in LIS PDF printouts',()=>{
 const result=parseSf1PdfText([
  'School Form 1 (SF1) School Register',
  'School Year: 2026-2027 Grade Level Grade 8 (Year)',
  'LRN NAME Sex (M/F)',
  '123456789012 DELA CRUZ, JUAN, SANTOS M'
 ].join('\n'));
 assert.equal(result.gradeLevel,'Grade 8');
});
