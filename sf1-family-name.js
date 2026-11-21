'use strict';
// Remove empty LIS name components without changing identities or inventing missing names.
function normalizeSf1FamilyName(value){
 const raw=String(value??'').trim().replace(/\s+/g,' ');
 if(!raw)return '';
 return raw.split(',').map(part=>part.trim().replace(/\s+/g,' ')).filter(part=>part && part!=='-').join(', ');
}
module.exports={normalizeSf1FamilyName};
