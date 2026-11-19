'use strict';
// Regression contract: derive the live version from portal HTML and require
// that exact asset in the service-worker shell. Avoid pinning obsolete releases.
const assert=require('node:assert/strict');
function escapeRegExp(s){return s.replace(/[|\\{}()[\]^$+*?.]/g,'\\$&');}
function assertCachedAsset(html,sw,assetName,{minimumVersion}={}){
 const name=assetName.replace(/^\//,'');
 const regex=new RegExp('(?:src|href)="(/'+escapeRegExp(name)+'\\?v=([^"]+))"','g');
 const found=[...html.matchAll(regex)];
 assert.equal(found.length,1,'Portal must reference one versioned '+name+' asset');
 const uri=found[0][1],version=found[0][2];
 assert.ok(sw.includes(JSON.stringify(uri)),'Offline service worker must cache EXACTLY '+uri);
 if(minimumVersion!==undefined){
  const numeric=Number(version);
  assert.ok(Number.isFinite(numeric)&&numeric>=minimumVersion,
    name+' version '+version+' must not regress below '+minimumVersion);
 }
 return uri;
}
function assertCacheRevisionAtLeast(sw,minimum){
 const match=sw.match(/const CACHE\s*=\s*"attendigo-v(\d+)-[^"]+"/);
 assert.ok(match,'Versioned service worker cache name required');
 assert.ok(Number(match[1])>=minimum,'Service worker revision must not regress below v'+minimum);
 return Number(match[1]);
}
module.exports={assertCachedAsset,assertCacheRevisionAtLeast};
