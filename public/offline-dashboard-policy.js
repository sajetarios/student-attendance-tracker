/* Public dashboard shell route policy. No account state, tokens, snapshots or
 * permission decisions are stored here. A matching route is NOT authorization.
 * The offline lease verifier must authenticate the identity and feature grants
 * before any private dashboard content or attendance controls are mounted.
 */
(function(root,factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  if(root)root.AttendigoOfflineDashboardPolicy=policy;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const workspaces=Object.freeze({
    '/portal.html':Object.freeze({title:'Staff workspace',roles:Object.freeze(['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER'])}),
    '/principal.html':Object.freeze({title:'Principal workspace',roles:Object.freeze(['PRINCIPAL'])}),
    '/student-portal.html':Object.freeze({title:'Student workspace',roles:Object.freeze(['STUDENT'])}),
    '/parent-portal.html':Object.freeze({title:'Parent workspace',roles:Object.freeze(['PARENT'])})
  });
  function workspaceForPath(path){
    return typeof path==='string'&&Object.hasOwn(workspaces,path)?workspaces[path]:null;
  }
  function routeForRole(role){
    if(typeof role!=='string')return null;
    return Object.keys(workspaces).find(path=>workspaces[path].roles.includes(role))||null;
  }
  function matchesRoute(path,role){
    return !!workspaceForPath(path)&&routeForRole(role)===path;
  }
  return Object.freeze({workspaceForPath,routeForRole,matchesRoute});
});
