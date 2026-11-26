'use strict';
// Only existing presentation CSS and version-only references to that CSS may
// qualify. Missing, uncertain, added, deleted or executable changes stay full.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const CSS=/^public\/[A-Za-z0-9_-]+\.css$/;
const HTML=/^public\/[A-Za-z0-9_-]+\.html$/;
const production='fix/render-login-landing';
function normalize(path,source,cssPaths){
  let value=source;
  for(const css of cssPaths){
    const escaped=('/'+css.slice('public/'.length)).replaceAll('.','\\.');
    const pattern=path==='public/sw.js'
      ? new RegExp('("'+escaped+'\\?v=)\\d+(")','g')
      : new RegExp('(href="'+escaped+'\\?v=)\\d+(")','g');
    value=value.replace(pattern,'$1VERSION$2');
  }
  if(path==='public/sw.js')value=value.replace(/^const CACHE = "attendigo-v\d+[A-Za-z0-9_-]*";$/m,'const CACHE = "CACHE_VERSION";');
  return value;
}
function classify(entries,read){
  if(!entries.length || entries.some(e=>e.status!=='M'||e.oldMode!=='100644'||e.newMode!=='100644'))return false;
  const cssPaths=entries.filter(e=>CSS.test(e.path)).map(e=>e.path);
  if(!cssPaths.length)return false;
  for(const {path} of entries){
    if(CSS.test(path))continue;
    if(path!=='public/sw.js'&&!HTML.test(path))return false;
    const [before,after]=read(path);
    if(typeof before!=='string'||typeof after!=='string')return false;
    if(normalize(path,before,cssPaths)!==normalize(path,after,cssPaths))return false;
  }
  return true;
}
function git(args){return execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024});}
function classifyGit(env=process.env){
  try{
    const {EVENT,BASE_REF,REF,BASE,HEAD}=env;
    const pr=EVENT==='pull_request'&&BASE_REF===production;
    const push=EVENT==='push'&&REF==='refs/heads/'+production;
    if(!pr&&!push)return false;
    if(!/^[0-9a-f]{40}$/.test(BASE||'')||!/^[0-9a-f]{40}$/.test(HEAD||'')||/^0+$/.test(BASE)||BASE===HEAD)return false;
    if(git(['rev-parse','HEAD']).trim()!==HEAD)return false;
    git(['merge-base','--is-ancestor',BASE,HEAD]);
    // Production fast lane only for actual merges from preceding branch tip.
    if(push){
      const parents=git(['rev-list','--parents','-n','1',HEAD]).trim().split(' ');
      if(parents.length!==3||parents[1]!==BASE)return false;
    }
    const fields=git(['diff','--raw','-z','--no-renames',BASE,HEAD,'--']).split('\0');
    if(fields.pop()!==''||fields.length%2!==0)return false;
    const entries=[];
    for(let i=0;i<fields.length;i+=2){
      const m=/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z][0-9]*)$/.exec(fields[i]);
      if(!m)return false;
      entries.push({oldMode:m[1],newMode:m[2],status:m[3],path:fields[i+1]});
    }
    return classify(entries,path=>[git(['show',BASE+':'+path]),git(['show',HEAD+':'+path])]);
  }catch(err){console.error('Release classification uncertain; full checks required:',err.message);return false;}
}
if(require.main===module){
  const ui=classifyGit();
  console.log(ui?'Verified stylesheet-only scope; core, security and responsive PR checks remain.':'Full regression scope.');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'ui_only='+String(ui)+'\n');
}
module.exports={classify,classifyGit};
