'use strict';
// Free local How-To Guide only. This endpoint never calls a paid AI provider.
// Keep the old routes for compatibility; clients now answer from bundled HTG.
const library=require('./public/attendigo-help-topics');
const ROLES=new Set(['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','GATE_KEEPER','PRINCIPAL']);
function allowed(req,res,next){
 if(req.auth?.type!=='SCHOOL_USER'||!ROLES.has(req.auth.role))
  return res.status(403).json({error:'Staff access is required.'});
 return next();
}
function buildInstructions(role,question){
 const matched=library.match(question,role);
 return [
  'Read-only verified Attendigo How-To Guide.',
  'Never fabricate features, permissions, official policies, actions or records.',
  'Only the documented guide is available; no private learner records.',
  matched ? matched.title+': '+matched.steps.join(' ') : 'No verified guide topic.'
 ].join('\n');
}
function registerHelpAiRoutes(app,authenticateSchoolClient){
 const auth=[authenticateSchoolClient,allowed];
 app.get('/api/help/config',...auth,(_req,res)=>{
  res.set('Cache-Control','no-store, private');
  res.json({aiEnabled:false,guideMode:'free-local'});
 });
 app.post('/api/help/ask',...auth,(_req,res)=>{
  res.set('Cache-Control','no-store, private');
  return res.status(503).json({error:'Ask Attendigo uses the free built-in guide. No external AI service is enabled.'});
 });
}
module.exports={registerHelpAiRoutes,buildInstructions};
