'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build,contrast,iconTone}=require('../public/attendigo-adaptive-palette');
test('Electric Violet fallback and school-selected hue',()=>{const a=build();assert.equal(a.nav,'#4f2dcc');assert.deepEqual(a.cards,['#b3a4ed','#83cbb5','#91bde8','#c0d99a']);const b=build('#006699');assert.equal(b.nav,'#006699');assert.notEqual(b.cards[0],a.cards[0]);assert.notEqual(b.cards[1],a.cards[1]);assert.deepEqual(build('invalid'),a);});
test('adaptive text meets 4.5:1 across dark, light, saturated, grayscale and RGB grid',()=>{for(let r=0;r<=255;r+=51)for(let g=0;g<=255;g+=51)for(let b=0;b<=255;b+=51){const color='#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');const p=build(color);assert.equal(p.nav,color);assert.ok(contrast(p.nav,p.navInk)>=4.5,color);assert.ok(contrast(p.primary,p.primaryInk)>=4.5,color);p.cards.forEach((c,i)=>assert.ok(contrast(c,p.cardInk[i])>=4.5,c));}});

test('icon contrast uses actual surface and neutral backing for conflicting gradient stops',()=>{for(const bg of ['#ffffff','#000000','#4f2dcc','#ffff00','#2ccb8f','#777777','#123456']){const t=iconTone([bg],'#777777');assert.ok(contrast(t.backing||bg,t.ink)>=4.5,bg);}const mixed=iconTone(['#000000','#ffffff'],'#777777');assert.ok(mixed.backing);assert.ok(contrast(mixed.backing,mixed.ink)>=4.5);assert.equal(iconTone(['#ffffff'],'#123456').ink,'#123456');});

test('decorative palettes avoid neon saturation and retain separated color families',()=>{
 for(const brand of ['#064324','#008000','#00ff00','#006699','#ff0000','#ffff00','#a32a70','#4f2dcc','#ffffff','#000000']){
  const p=build(brand);assert.equal(p.nav,brand);assert.equal(new Set(p.cards).size,4);
  for(const card of p.cards){const rgb=card.slice(1).match(/../g).map(v=>parseInt(v,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),l=(max+min)/2,s=(max-min)/(1-Math.abs(2*l-1));assert.ok(s<.70,card);assert.ok(l>=.65&&l<=.85,card);}
  assert.ok(contrast(p.primary,'#ffffff')>=4.5,p.primary);
 }
 const green=build('#064324');const [mint,blue,warm,rose]=green.cards.map(c=>c.slice(1).match(/../g).map(x=>parseInt(x,16)));assert.ok(mint[1]>mint[0]&&mint[1]>mint[2]);assert.ok(blue[2]>blue[0]&&blue[2]>blue[1]);assert.ok(warm[0]>warm[2]);assert.ok(rose[0]>rose[1]);
});
