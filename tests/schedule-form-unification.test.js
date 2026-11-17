'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('schedule block comes before editable label and preview',()=>{
 const f=read('public/portal.html').split('<form id="scheduleForm"')[1].split('</form>')[0];
 const ids=['scheduleTemplate','scheduleTemplatePeriod','periodName','startTime','scheduleTimePreview','periodTeacher','periodSection','scheduleWeekdayChoices','scheduleReviewSummary'];
 for(let i=1;i<ids.length;i++)assert.ok(f.indexOf('id="'+ids[i]+'"')>f.indexOf('id="'+ids[i-1]+'"'),ids[i]);
 for(const id of ['periodName','scheduleTemplate','scheduleTemplatePeriod','startTime','endTime','periodTeacher','periodSubject','periodGrade','periodSection','periodClassroom','graceMinutes'])assert.equal((f.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 assert.doesNotMatch(f,/id="periodName"[^>]*readonly/);
});
test('saved timetable enforces times but lets user label classes independently',()=>{
 const js=read('public/portal.js'),server=read('server.js');
 assert.match(js,/function suggestScheduleLabel\(suggestion\)/);
 assert.doesNotMatch(js,/payload\.periodName !== period\.label/);
 assert.doesNotMatch(js,/block\.label !== payload\.periodName/);
 assert.match(server,/if \(savedBlock\.start_time !== startTime/);
 assert.match(js,/function updateScheduleReview\(\)/);
});
