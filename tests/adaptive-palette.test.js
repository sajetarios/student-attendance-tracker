'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build,contrast}=require('../public/attendigo-adaptive-palette');
test('Electric Violet fallback and school-selected hue',()=>{const a=build();assert.equal(a.nav,'#4f2dcc');assert.deepEqual(a.cards,['#6c4dff','#2ccb8f','#4da3ff','#8bcf3f']);const b=build('#006699');assert.equal(b.nav,'#006699');assert.notEqual(b.cards[0],a.cards[0]);assert.equal(b.cards[1],a.cards[1]);assert.deepEqual(build('invalid'),a);});
test('adaptive text meets 4.5:1 across dark, light, saturated, grayscale and RGB grid',()=>{for(let r=0;r<=255;r+=51)for(let g=0;g<=255;g+=51)for(let b=0;b<=255;b+=51){const color='#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');const p=build(color);assert.equal(p.nav,color);assert.ok(contrast(p.nav,p.navInk)>=4.5,color);assert.ok(contrast(p.primary,p.primaryInk)>=4.5,color);p.cards.forEach((c,i)=>assert.ok(contrast(c,p.cardInk[i])>=4.5,c));}});
