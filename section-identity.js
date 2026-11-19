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
  // Restricted Damerau-Levenshtein also catches a swapped pair of letters.
  const dp=Array.from({length:x.length+1},()=>Array(y.length+1).fill(0));
  for(let i=0;i<=x.length;i++)dp[i][0]=i;
  for(let j=0;j<=y.length;j++)dp[0][j]=j;
  for(let i=1;i<=x.length;i++)for(let j=1;j<=y.length;j++){
    dp[i][j]=Math.min(
      dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(x[i-1]===y[j-1]?0:1)
    );
    if(i>1&&j>1&&x[i-1]===y[j-2]&&x[i-2]===y[j-1])
      dp[i][j]=Math.min(dp[i][j],dp[i-2][j-2]+1);
  }
  return dp[x.length][y.length];
}
function isSimilar(a,b) {
  const x=sectionKey(a),y=sectionKey(b);
  if(!x||!y||x===y)return false;
  const longest=Math.max(x.length,y.length);
  if(longest<5)return false;
  return distance(x,y)<=(longest>=8?2:1);
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
