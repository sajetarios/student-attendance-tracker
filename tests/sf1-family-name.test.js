'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeSf1FamilyName}=require('../sf1-family-name');
test('drops empty SF1 name components without changing meaningful parts',()=>{
 assert.equal(normalizeSf1FamilyName('Roxas, Ana,,'),'Roxas, Ana');
 assert.equal(normalizeSf1FamilyName('Roxas, ana, '),'Roxas, ana');
 assert.equal(normalizeSf1FamilyName('  Roxas , Ana ,  Marie  , '),'Roxas, Ana, Marie');
 assert.equal(normalizeSf1FamilyName('Dela Cruz, Juan, Jr.'),'Dela Cruz, Juan, Jr.');
 assert.equal(normalizeSf1FamilyName('BELOY,MARY,-'),'BELOY, MARY');
 assert.equal(normalizeSf1FamilyName('LINTUAN,ANALIZA,-'),'LINTUAN, ANALIZA');
 assert.equal(normalizeSf1FamilyName('SANTOS, ANNE-MARIE'),'SANTOS, ANNE-MARIE');
 assert.equal(normalizeSf1FamilyName(''), '');
});
