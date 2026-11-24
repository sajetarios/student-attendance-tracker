'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveSubjectStatus}=require('../parent-subject-status');
const base={schoolDate:'2026-11-24',endTime:'09:30:00',finalized:false,manualStatus:null,qrStatus:null,closed:false,adjustmentType:''};
const today='2026-11-24';
test('a school gate scan never proves class attendance',()=>{
 assert.equal(resolveSubjectStatus({...base,gateRecorded:true},{today,nowMinutes:600}),'PENDING');
 assert.equal(resolveSubjectStatus({...base,gateRecorded:true,manualStatus:'ABSENT'},{today,nowMinutes:600}),'PENDING');
});
test('only finalized class marks can confirm an absence',()=>{
 assert.equal(resolveSubjectStatus({...base,manualStatus:'ABSENT',finalized:true},{today,nowMinutes:600}),'ABSENT');
 assert.equal(resolveSubjectStatus({...base,manualStatus:'EXCUSED',finalized:true},{today,nowMinutes:600}),'EXCUSED');
});
test('class QR overrides blank manual mark but conflict requires teacher review',()=>{
 assert.equal(resolveSubjectStatus({...base,finalized:true,qrStatus:'PRESENT'},{today,nowMinutes:600}),'PRESENT');
 assert.equal(resolveSubjectStatus({...base,finalized:true,qrStatus:'LATE'},{today,nowMinutes:600}),'LATE');
 assert.equal(resolveSubjectStatus({...base,finalized:true,qrStatus:'PRESENT',manualStatus:'ABSENT'},{today,nowMinutes:600}),'REVIEW');
});
test('reconciliation keeps an explicit late mark',()=>{
 assert.equal(resolveSubjectStatus({...base,finalized:true,qrStatus:'PRESENT',manualStatus:'LATE'},{today,nowMinutes:600}),'LATE');
 assert.equal(resolveSubjectStatus({...base,finalized:true,qrStatus:'LATE',manualStatus:'PRESENT'},{today,nowMinutes:600}),'LATE');
});
test('unfinished periods and cancellations cannot generate an absence',()=>{
 assert.equal(resolveSubjectStatus({...base},{today,nowMinutes:520}),'IN_PROGRESS');
 assert.equal(resolveSubjectStatus({...base,closed:true},{today,nowMinutes:600}),'CANCELLED');
 assert.equal(resolveSubjectStatus({...base,adjustmentType:'CANCEL'},{today,nowMinutes:600}),'CANCELLED');
 assert.equal(resolveSubjectStatus({...base,schoolDate:'2026-11-25'},{today,nowMinutes:600}),'UPCOMING');
});
