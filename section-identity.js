'use strict';
// Section identity is scoped to school + grade. Never merge records based on a fuzzy match.
function sectionKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s._-]+/g, '');
}
function gradeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}
function distance(a,b) {
  const x=sectionKey(a),y=sectionKey(b);
  if(x===y)return 0;
  if(!x.length||!y.length)return Math.max(x.length,y.length);
  let prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){
    const row=[i];
    for(let j=1;j<=y.length;j++)row.push(Math.min(
      row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1)
    ));
    prev=row;
  }
  return prev[y.length];
}
function isSimilar(a,b) {
  const x=sectionKey(a),y=sectionKey(b);
  if(!x||!y||x===y)return false;
  const longest=Math.max(x.length,y.length);
  if(longest<5)return false;
  return distance(x,y)<=Math.min(2,Math.floor(longest*.22));
}
function inspectName(name, existing) {
  const same=[],similar=[];
  for(const item of existing){
    if(sectionKey(item.sectionName)===sectionKey(name))same.push(item);
    else if(isSimilar(name,item.sectionName))similar.push(item);
  }
  return {exact:same,similar:similar.slice(0,6)};
}
module.exports={sectionKey,gradeKey,distance,isSimilar,inspectName};
