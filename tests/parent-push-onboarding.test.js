'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('public/parent-portal.html','utf8');
const script=fs.readFileSync('public/parent-push.js','utf8');
const css=fs.readFileSync('public/parent-push.css','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');

test('parental notification setup is a readable sequence with clear controls',()=>{
 for(const id of ['pushNotifications','pushSetupSteps','pushIosGuide','pushCopyLink',
   'pushEnable','pushTest','pushDisable','pushStatus','pushStateBadge','pushSettings','pushSettingsToggle','pushSummary']){
   assert.ok(ui.includes('id="'+id+'"'),id+' missing from parent portal');
 }
 assert.match(ui,/Add to Home Screen/);
 assert.match(ui,/Open as Web App/);
 assert.match(ui,/Activate phone alerts/);
 assert.match(ui,/Send another test/);
 assert.match(ui,/\/parent-push\.js\?v=3/);
 assert.match(ui,/\/parent-push\.css\?v=3/);
});
test('iPhones show required Home Screen instructions before requesting permission',()=>{
 assert.match(script,/isIOS&&!installed\(\)/);
 assert.match(script,/controls\(\{install:true\}\)/);
 assert.match(script,/navigator\.standalone===true/);
 assert.match(script,/Open Attendigo from its new icon|open Attendigo from its new icon|open Attendigo from/);
});
test('permission prompts require a user action and are never called automatically on load',()=>{
 const clicked=script.indexOf("enable.addEventListener('click'");
 const requested=script.indexOf('Notification.requestPermission()');
 const auto=script.lastIndexOf('void refresh();');
 assert.ok(clicked>=0&&requested>clicked&&requested<auto);
 const setup=script.slice(0,clicked);
 assert.doesNotMatch(setup,/Notification\.requestPermission\(\)/);
 assert.match(script,/userVisibleOnly:true/);
 assert.match(script,/await registerExisting\(current\)/);
 assert.match(script,/await sendTest\(current\)/);
});
test('re-establishing phone registration is constrained to existing parental opt-in',()=>{
 assert.match(script,/const OPT_IN=/);
 assert.match(script,/localStorage\.getItem\(OPT_IN\)==='yes'/);
 assert.match(script,/current&&Notification\.permission==='granted'&&opted/);
 assert.match(script,/await registerExisting\(current\)/);
 assert.match(script,/setOptIn\(false\)/);
 assert.doesNotMatch(script,/Notification\.permission='granted'/);
});
test('guided setup stays responsive and remains compatible with the light and dark themes',()=>{
 assert.match(css,/\.parent-push-steps/);
 assert.match(css,/data-state=current/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/var\(--card/);
 assert.match(sw,/attendigo-v331-compact-parent-push-settings/);
 assert.match(sw,/\/parent-push\.js/);
});

test('active subscriptions collapse setup and retain accessible settings; errors reopen details',()=>{
 assert.match(ui,/id="pushSettingsToggle" aria-expanded="false" aria-controls="pushSettings" hidden/);
 assert.ok(ui.indexOf('id="pushSettings"')<ui.indexOf('id="pushTest"'));
 assert.match(script,/settings\.hidden=activeLayout&&!settingsOpen/);
 assert.match(script,/setActiveLayout\(active\)/);
 assert.match(script,/if\(active!==activeLayout\)\{settingsOpen=false;activeLayout=active;\}/);
 assert.match(script,/if\(error&&activeLayout\)\{settingsOpen=true;renderSettings\(\);\}/);
 assert.match(script,/toggle\.setAttribute\('aria-expanded',String\(activeLayout&&settingsOpen\)\)/);
 assert.match(css,/\.parent-phone-push\[data-compact=true\]/);
});
