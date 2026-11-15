'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parsePhoto,registerPhotoRoutes,registerPlatformPhotoRoutes}=require('../profile-photo-routes');
const load=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const webp=Buffer.from('RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00\x00\x00\x00\x00','latin1').toString('base64');
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
const payload={originalMime:'image/png',original:png,cropped:webp,thumb:webp};
test('valid binary signatures are required for normalized, private images',()=>{
 const p=parsePhoto(payload);
 assert.equal(p.originalMime,'image/png');
 assert.ok(Buffer.isBuffer(p.original)&&Buffer.isBuffer(p.cropped));
 assert.throws(()=>parsePhoto({...payload,originalMime:'image/jpeg'}),/supported image/);
 assert.throws(()=>parsePhoto({...payload,cropped:'abc'}));
});
test('official updates, staff upload, student requests and reviews are separate authenticated routes',()=>{
 const endpoints={};
 const auth=(req,res,next)=>next();
 const app={get(path,...handlers){endpoints['GET '+path]=handlers;},post(path,...handlers){endpoints['POST '+path]=handlers;}};
 registerPhotoRoutes(app,{}, {authenticateSchoolClient:auth});
 for(const path of ['/api/photos/me','/api/photos/requests','/api/photos/requests/:requestId/preview'])
   assert.equal(endpoints['GET '+path][0],auth);
 for(const path of ['/api/photos/self','/api/photos/request/student/:studentId',
  '/api/photos/official/:kind/:id','/api/photos/requests/:requestId/review'])
   assert.equal(endpoints['POST '+path][0],auth);
 const source=load('profile-photo-routes.js');
 assert.match(source,/canManageStudent/);
 assert.match(source,/isLinkedParent/);
 assert.match(source,/status='PENDING'/);
 assert.match(source,/request\.requested_by_user_id===req\.auth\.userId/);
});
test('Super Admin photo APIs use platform-specific authentication and storage',()=>{
 const endpoints={};
 const platform=(req,res,next)=>next();
 const admin=(req,res,next)=>next();
 const app={get(path,...handlers){endpoints['GET '+path]=handlers;},post(path,...handlers){endpoints['POST '+path]=handlers;}};
 registerPlatformPhotoRoutes(app,{}, {authenticatePlatform:platform,requirePlatformAdmin:admin});
 for(const method of ['GET','POST']){
  const guards=endpoints[method+' /api/platform/profile-photo'];
  assert.equal(guards[0],platform);
  assert.equal(guards[1],admin);
 }
 assert.match(load('public/photo-editor.js'),/role==='SUPER_ADMIN'/);
 assert.match(load('public/photo-editor.js'),/Submit for approval/);
 assert.match(load('scripts/migrate.js'),/027_platform_admin_profile_photos.sql/);
});
test('crop UI and approval workflow use locally generated fixed-size images',()=>{
 const s=load('public/photo-editor.js');
 assert.match(s,/canvas\.width=128|thumb\.width=128/);
 assert.match(s,/width="512" height="512"/);
 assert.match(s,/Math\.min:Math\.max/);
 assert.match(s,/pointermove/);
 assert.match(s,/Skip cropping/);
 assert.match(s,/mountReviews/);
 assert.match(s,/mountParentStudentRequests/);
});
test('photo editor is available on all relevant dashboard pages, including offline shell',()=>{
 const sw=load('public/sw.js');
 for(const page of ['portal','parent-portal','student-portal']){
  const html=load('public/'+page+'.html');
  assert.match(html,/photo-editor\.css\?v=1/);
  assert.match(html,/photo-editor\.js\?v=1/);
 }
 assert.match(sw,/photo-editor\.js\?v=1/);
 assert.match(sw,/photo-editor\.css\?v=1/);
});
