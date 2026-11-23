'use strict';
// Compatibility for previously issued school-memorandum links.
// Memoranda are now read inside each authenticated user's existing portal.
(async()=>{
 const id=new URLSearchParams(location.search).get('id');
 const token=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id||''))?id:'';
 try{
  const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Not signed in');
  const data=await response.json();
  const role=data?.user?.role;
  const path=role==='PRINCIPAL'?'/principal.html':
   role==='PARENT'?'/parent-portal.html':
   role==='STUDENT'?'/student-portal.html':'/portal.html';
  if(role)location.replace(path+(token?'?memo='+encodeURIComponent(token):''));
  else location.replace('/portal-login.html');
 }catch(_){location.replace('/portal-login.html');}
})();