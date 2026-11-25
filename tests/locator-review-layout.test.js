'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/central-locator-ui.js','utf8'),css=fs.readFileSync('public/document-branding.css','utf8');
test('review workspace uses responsive preview and ordered step cards',()=>{assert.match(source,/workspace.append\(pattern,preview,mappingCard,sampleCard,verification\)/);assert.match(css,/grid-template-areas:"preview pattern"/);assert.match(css,/grid-template-areas:"pattern" "preview" "mapping" "sample" "publish"/);assert.match(source,/sheet.hidden=!id;emptyPreview.hidden=!!id/);assert.match(source,/verification.hidden=!proof&&!published/);});
test('opening form recomputes action readiness after busy state clears',()=>{assert.match(source,/finally\{busy=false;select.disabled=false;draw\(\);\}/);assert.match(source,/sample.disabled=busy\|\|!id/);assert.match(source,/const missing=required.filter/);});
test('review UI parses and keeps publication checks',()=>{new vm.Script(source);assert.match(source,/!proof\|\|!check.checked\|\|!division.checked/);assert.match(source,/businessConfirmed:businessConfirm.checked/);});
