'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {extractName,extractOfficialName}=require('../sf1-import-parser');
const {sf1NameAliases,sf1NamesEquivalent}=require('../sf1-import-routes');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('official LIS comma delimiters preserve surname, given names and middle name',()=>{
 assert.equal(extractName('DE LA CRUZ, ANA MARIA, SANTOS'),'ANA MARIA SANTOS DE LA CRUZ');
 assert.equal(extractOfficialName('DE LA CRUZ, ANA MARIA, SANTOS'),'DE LA CRUZ, ANA MARIA SANTOS');
 assert.equal(extractOfficialName('RAMOS, ANA, -'),'RAMOS, ANA');
 assert.equal(extractOfficialName('UNSTRUCTURED RECORD'),'');
});
test('SF1 review matches a legacy flattened name to the source-verified official order',()=>{
 assert.equal(sf1NamesEquivalent('DE LA CRUZ, ANA MARIA SANTOS','ANA MARIA SANTOS DE LA CRUZ'),true);
 assert.equal(sf1NamesEquivalent('RAMOS, ANA','ANA RAMOS'),true);
 assert.equal(sf1NamesEquivalent('SANTOS, ANA MARIA','ANA MARIA DE LA CRUZ'),false);
 assert.equal(sf1NamesEquivalent('ANA MARIA SANTOS DE LA CRUZ','DE LA CRUZ, ANA MARIA SANTOS'),false);
 assert.deepEqual(sf1NameAliases('RAMOS, ANA'),['ramosana','anaramos']);
});
test('Excel and PDF importers save official names only when source delimiters are present',()=>{
 const parser=read('sf1-import-parser.js');
 const pdf=read('sf1-pdf-parser.js');
 const layout=read('sf1-pdf-layout.js');
 const route=read('sf1-import-routes.js');
 for(const text of [parser,pdf,layout])assert.match(text,/officialFullName:extractOfficialName/);
 assert.match(route,/row\.officialFullName\|\|row\.fullName/);
 assert.match(route,/sf1NamesEquivalent\(found\.full_name,r\.fullName\)/);
 assert.match(route,/sf1NameAliases\(student\.full_name\)/);
 assert.match(route,/btrim\(split_part\(full_name,',',2\)\)/);
});
test('guarded migration uses fingerprint and audit, contains no learner name or LRN data',()=>{
 const migration=read('migrations/070_verified_mnchs_sf1_name_order.sql');
 const registry=read('scripts/migrate.js');
 assert.match(registry,/070_verified_mnchs_sf1_name_order\.sql/);
 for(const k of ['dc3cdd9b224bb15c3d3522bc20df40b2','SF1_VERIFIED_NAME_ORDER_CORRECTION','matched_count<>28','class_count<>28','changed_count<>28','actual_fingerprint IS DISTINCT FROM expected_fingerprint','previousFullName','verifiedFullName']){
  assert.ok(migration.includes(k),k);
 }
 assert.doesNotMatch(migration,/\b(?:ANDRIANA|LUMANDONG|CRETICIO|NONONG|BELOY)\b/);
 assert.match(migration,/UPDATE students s\s+SET full_name=c\.official_name/);
 assert.doesNotMatch(migration,/SET.*\b(?:lrn|qr_token|birth_date)\s*=/s);
});
