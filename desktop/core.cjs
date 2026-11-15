'use strict';
const {randomUUID,randomBytes,scryptSync,timingSafeEqual}=require('node:crypto');
const ORIGIN='https://student-attendance-tracker-jmp4.onrender.com';
const OFFLINE_DAYS=7;
const identity=(s,u)=>`${s.trim().toLowerCase()}/${u.trim().toLowerCase()}`;
class Attendance {
 constructor({read,write,request,now=()=>Date.now()}) {Object.assign(this,{read,write,request,now});this.unlocked=false;this.data=read();this.failures=0;this.retryAt=0;}
 save(){this.write(this.data);}
 require(){if(!this.unlocked||!this.data)throw Error('Sign in or unlock your offline account first.');if(this.now()-this.data.verifiedAt>OFFLINE_DAYS*86400000){this.unlocked=false;throw Error('Connect and sign in again to renew offline access. Saved attendance is preserved.');}return this.data;}
 snapshot(){const d=this.require();return {user:d.user,students:d.students,periods:d.periods,events:d.events.slice(-500).reverse(),pending:d.events.filter(e=>e.syncStatus==='PENDING').length,refreshedAt:d.refreshedAt,offlineUntil:new Date(d.verifiedAt+OFFLINE_DAYS*86400000).toISOString()};}
 async login({schoolCode,username,password,offline=false}){
  if(![schoolCode,username,password].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw Error('Enter school code, username and password.');
  this.unlocked=false;
  const key=identity(schoolCode,username);
  if(offline){
   if(this.now()<this.retryAt)throw Error('Too many unlock attempts. Try again in one minute.');
   const d=this.data;const valid=d&&d.identity===key&&timingSafeEqual(scryptSync(password,d.salt,32),Buffer.from(d.verifier,'hex'));
   if(!valid){if(++this.failures>=5){this.retryAt=this.now()+60000;this.failures=0;}throw Error('Offline credentials did not match. Sign in online once before using offline access.');}
   this.unlocked=true;this.failures=0;return this.snapshot();
  }
  const session=await this.request('/api/auth/school/login',{method:'POST',body:{schoolCode,username,password}});
  if(session.user.role!=='TEACHER')throw Error('Offline recording is for teacher accounts. Use Open online portal for other roles.');
  if(session.user.mustChangePassword)throw Error('Change your password in the online portal, then sign in here.');
  if(!session.user.teacherDesignations?.some(v=>['SUBJECT_TEACHER','CLASS_ADVISER'].includes(v)))throw Error('Your account needs a subject teacher or class adviser designation.');
  const same=this.data?.user.schoolId===session.user.schoolId&&this.data?.user.userId===session.user.userId;
  if(this.data&&!same)throw Error('This installation is linked to another teacher. Use a separate computer login to keep attendance accounts separate.');
  const salt=randomBytes(16).toString('hex');
  this.data={...(same?this.data:{students:[],periods:[],events:[],deviceId:randomUUID()}),identity:key,user:session.user,token:session.accessToken,verifiedAt:this.now(),salt,verifier:scryptSync(password,salt,32).toString('hex')};
  this.save();this.unlocked=true;return this.snapshot();
 }
 async refresh(){const d=this.require();const [roster,schedule]=await Promise.all([this.request('/api/students',{token:d.token}),this.request('/api/periods',{token:d.token})]);
  if(!Array.isArray(roster.students)||!Array.isArray(schedule.periods))throw Error('Invalid roster response. Previous offline data is preserved.');
  // Only keep the learner data needed for attendance, never guardian contact details.
  d.students=roster.students.map(({studentId,fullName,gradeLevel,section,qrToken})=>({studentId,fullName,gradeLevel,section,qrToken}));d.periods=schedule.periods;d.refreshedAt=new Date(this.now()).toISOString();this.save();return this.snapshot();}
 record({studentId,attendanceScope,periodId,eventType}){
  const d=this.require();const designation=attendanceScope==='CLASS'?'SUBJECT_TEACHER':attendanceScope==='ADVISORY'?'CLASS_ADVISER':null;
  if(!designation||!d.user.teacherDesignations.includes(designation))throw Error('This attendance type is not permitted for your account.');
  if(!['TIME_IN','TIME_OUT'].includes(eventType))throw Error('Invalid attendance action.');
  const s=d.students.find(s=>s.studentId===studentId||`JHS:${s.qrToken}`===studentId);
  if(!s)throw Error('Student not in your downloaded roster. Download your roster while online first.');
  if(attendanceScope==='CLASS'){
   const p=d.periods.find(p=>String(p.periodId)===String(periodId));
   if(!p||p.assignedTeacherUserId!==d.user.userId)throw Error('Select a class assigned to you.');
   if(s.gradeLevel!==p.gradeLevel||(p.section&&s.section!==p.section))throw Error('Student is not in this class.');
  }
  const now=new Date(this.now());const schoolDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const event={eventId:randomUUID(),deviceId:d.deviceId,studentId:s.studentId,attendanceScope,periodId:attendanceScope==='CLASS'?periodId:null,eventType,occurredAt:now.toISOString(),schoolDate,syncStatus:'PENDING',metadata:{deviceId:d.deviceId,source:'desktop-offline'}};
  d.events.push(event);try{this.save();}catch(e){d.events.pop();throw e;}return this.snapshot();
 }
 async sync(){const d=this.require();const pending=d.events.filter(e=>e.syncStatus==='PENDING');
  for(let i=0;i<pending.length;i+=500){const batch=pending.slice(i,i+500);const result=await this.request('/api/sync/events',{method:'POST',token:d.token,body:{events:batch}});
   if(!Array.isArray(result.results))throw Error('Invalid sync response. Attendance is still saved locally.');
   for(const r of result.results){const e=batch.find(e=>e.eventId===r.eventId);if(!e)continue;if(['ACCEPTED','ALREADY_SYNCED'].includes(r.status))e.syncStatus='SYNCED';else if(['REJECTED','DUPLICATE'].includes(r.status))e.syncStatus=r.status;else continue;e.reason=r.reason||'';}
   this.save();
  }return this.snapshot();
 }
 lock(){this.unlocked=false;return true;}
}
module.exports={Attendance,ORIGIN};
