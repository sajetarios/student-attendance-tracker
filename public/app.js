const $ = id => document.getElementById(id);
const DB_NAME="school-attendance-local", DB_VERSION=2;
let db, qrScanner=null, scanLoop=false;
function makeUuid(){
 if(globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
 return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
  const r=Math.random()*16|0;
  return (c==="x"?r:(r&3|8)).toString(16);
 });
}
let deviceId=localStorage.getItem("attendance_device_id");
if(!deviceId){
 deviceId=makeUuid();
 localStorage.setItem("attendance_device_id",deviceId);
}
$("deviceShort").textContent=deviceId.slice(0,8);
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("events")){const s=d.createObjectStore("events",{keyPath:"eventId"});s.createIndex("byDate","schoolDate");s.createIndex("bySync","syncStatus");}if(!d.objectStoreNames.contains("students"))d.createObjectStore("students",{keyPath:"studentId"});if(!d.objectStoreNames.contains("periods"))d.createObjectStore("periods",{keyPath:"periodId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function store(n,m="readonly"){return db.transaction(n,m).objectStore(n);}
async function all(n){return req(store(n).getAll());}
async function put(n,v){return req(store(n,"readwrite").put(v));}
function todayManila(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function feedback(id,msg,type=""){const el=$(id);el.textContent=msg;el.className="feedback "+type;}
function connection(){const e=$("connection");e.textContent=navigator.onLine?"Online":"Offline mode";e.className="status "+(navigator.onLine?"online":"offline");}
function api(){return $("apiUrl").value.trim().replace(/\/$/,"");}
function headers(){return {"Content-Type":"application/json","Authorization":"Bearer "+$("apiToken").value.trim()};}
function tab(name){document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==name);}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$("scope").onchange=()=>{$("periodWrap").hidden=$("scope").value!=="CLASS";};
async function refreshDashboard(){
 if(!navigator.onLine||!api()||!$("apiToken").value.trim()){feedback("dashboardFeedback","Dashboard needs a connection to the local server.");return;}
 try{
  const r=await fetch(api()+"/api/admin/dashboard",{headers:headers()});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Dashboard request failed");
  $("adminStudents").textContent=d.students.active;
  $("adminArrivals").textContent=d.today.school_arrivals;
  $("adminLate").textContent=d.today.late_arrivals;
  $("adminClasses").textContent=d.today.class_checkins;
  $("adminSmsPending").textContent=(d.sms.PENDING||0)+(d.sms.SENDING||0);
  $("adminSmsFailed").textContent=d.sms.FAILED||0;
  $("adminRecent").innerHTML="";
  (d.recent||[]).forEach(e=>{
   const tr=document.createElement("tr");
   [e.fullName,new Date(e.occurredAt).toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}),e.scope,e.eventType.replace("_"," "),e.syncStatus+(e.late?" · LATE":"")].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);});
   $("adminRecent").append(tr);
  });
  feedback("dashboardFeedback","Dashboard refreshed from local server.","success");
 }catch(e){feedback("dashboardFeedback",e.message,"error");}
}
async function render(){
 const events=(await all("events")).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 $("countToday").textContent=events.filter(e=>e.schoolDate===todayManila()).length;
 $("countPending").textContent=events.filter(e=>e.syncStatus==="PENDING").length;
 $("records").innerHTML="";
 if(!events.length){$("records").innerHTML='<tr><td colspan="5">No punches yet.</td></tr>';return;}
 for(const e of events.slice(0,40)){
  const tr=document.createElement("tr"), vals=[e.studentId,new Date(e.occurredAt).toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"}),e.attendanceScope,e.eventType.replace("_"," ")];
  vals.forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td);});
  const td=document.createElement("td"),pill=document.createElement("span");pill.className="pill "+(e.syncStatus==="SYNCED"?"synced":"");pill.textContent=e.syncStatus;td.append(pill);tr.append(td);$("records").append(tr);
 }
}
async function refreshRoster(){
 if(!navigator.onLine||!api()||!$("apiToken").value.trim())return;
 try{const r=await fetch(api()+"/api/students",{headers:headers()});if(!r.ok)throw Error("Roster request failed: "+r.status);const data=await r.json();const enriched=[];for(const s of data.students){let photoDataUrl=s.photoDataUrl||null;if(s.photoUrl){try{const pr=await fetch(api()+s.photoUrl,{headers:{Authorization:"Bearer "+$("apiToken").value.trim()},cache:"no-store"});if(pr.ok){const blob=await pr.blob();photoDataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});}}catch(e){console.warn("Student photo cache failed",s.studentId,e);}}else{photoDataUrl=null;}enriched.push({...s,photoDataUrl});}const tx=db.transaction("students","readwrite");enriched.forEach(s=>tx.objectStore("students").put(s));await renderStudentRoster(enriched);}
 catch(e){console.warn(e);feedback("studentFeedback",e.message,"error");}
}
async function renderStudentRoster(list){
 const students=list||await all("students"), host=$("studentRoster");host.innerHTML="";
 const grade=$("qrGradeFilter")?.value||"ALL";
 const filtered=students.filter(s=>grade==="ALL"||s.gradeLevel===grade).sort((a,b)=>a.fullName.localeCompare(b.fullName));
 if(!filtered.length){host.innerHTML='<p class="hint">No students found for this filter. Register a student or refresh the roster.</p>';return;}
 filtered.forEach(s=>{
  const row=document.createElement("article");row.className="student-row";
  const photo=document.createElement("img");photo.className="student-roster-photo";photo.alt="";photo.src=s.photoDataUrl||"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23e8eef4'/%3E%3Ccircle cx='32' cy='24' r='11' fill='%2395a6b6'/%3E%3Cpath d='M10 60c2-14 10-21 22-21s20 7 22 21' fill='%2395a6b6'/%3E%3C/svg%3E";
  const details=document.createElement("div");details.className="student-details";
  const name=document.createElement("strong");name.textContent=s.fullName;
  const meta=document.createElement("span");meta.textContent=`${s.studentId} · ${s.gradeLevel} · ${s.section}`;
  details.append(name,meta);
  const actions=document.createElement("div");actions.className="student-actions";
  const preview=document.createElement("button");preview.className="secondary";preview.textContent="View / print ID";preview.onclick=()=>printStudentCard(s);
  const download=document.createElement("button");download.className="secondary";download.textContent="Download QR";download.onclick=()=>downloadStudentQr(s);
  actions.append(preview,download);row.append(photo,details,actions);host.append(row);
 });
}
async function getStudentQr(student){
 const r=await fetch(api()+"/api/students/"+encodeURIComponent(student.studentId)+"/qr",{headers:headers()});
 const data=await r.json();if(!r.ok)throw Error(data.error||"QR generation failed");return data.qrDataUrl;
}
function cardMarkup(s,qr){
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 return `<article class="print-card"><div class="card-school">JUNIOR HIGH SCHOOL<br><small>STUDENT IDENTIFICATION</small></div><div class="card-body">${s.photoDataUrl?`<img class="student-photo" src="${s.photoDataUrl}" alt="Student photo">`:""}<div><h2>${esc(s.fullName)}</h2><p><b>Student ID:</b> ${esc(s.studentId)}</p><p><b>Grade:</b> ${esc(s.gradeLevel)}</p><p><b>Section:</b> ${esc(s.section)}</p></div><img src="${qr}" alt="Student QR code"></div><div class="card-footer">Present this QR code at the school attendance entrance.</div></article>`;
}
function openPrintWindow(cards){
 const w=window.open("","_blank");if(!w){feedback("studentFeedback","Allow pop-ups for this school attendance site to print ID cards.","error");return;}
 w.document.write(`<!doctype html><html><head><title>JHS Student QR ID Cards</title><style>body{font-family:Arial,sans-serif;margin:18px;display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.print-card{border:1.5px solid #23476b;border-radius:12px;overflow:hidden;break-inside:avoid;min-height:205px}.card-school{background:#12345a;color:white;padding:12px;font-weight:bold;font-size:13px;letter-spacing:.04em}.card-school small{font-weight:normal;font-size:10px}.card-body{display:flex;justify-content:space-between;align-items:center;padding:12px;gap:8px}.card-body h2{font-size:15px;margin:0 0 10px}.card-body p{font-size:11px;margin:5px 0}.card-body img{width:92px;height:92px;object-fit:contain}.card-body img.student-photo{border-radius:8px;object-fit:cover}.card-footer{border-top:1px solid #ddd;padding:8px 12px;font-size:9px;color:#536579}@media print{body{margin:8mm}.print-card{page-break-inside:avoid}}</style></head><body>${cards.join("")}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
 w.document.close();
}
async function printStudentCard(student){
 if(!api()||!$("apiToken").value.trim())return feedback("studentFeedback","Configure the school server connection first.","error");
 try{const qr=await getStudentQr(student);openPrintWindow([cardMarkup(student,qr)]);}catch(e){feedback("studentFeedback",e.message,"error");}
}
async function downloadStudentQr(student){
 if(!api()||!$("apiToken").value.trim())return feedback("studentFeedback","Configure the school server connection first.","error");
 try{const qr=await getStudentQr(student);const a=document.createElement("a");a.href=qr;a.download=`${student.studentId}-QR.png`;a.click();}catch(e){feedback("studentFeedback",e.message,"error");}
}
async function printFilteredCards(){
 if(!navigator.onLine||!api()||!$("apiToken").value.trim())return feedback("studentFeedback","Connect to the school server to generate printable QR cards.","error");
 const grade=$("qrGradeFilter").value, students=(await all("students")).filter(s=>grade==="ALL"||s.gradeLevel===grade);
 if(!students.length)return feedback("studentFeedback","No students available for this grade filter.","error");
 feedback("studentFeedback",`Generating ${students.length} QR ID card(s)…`);
 try{const cards=[];for(const student of students){const qr=await getStudentQr(student);cards.push(cardMarkup(student,qr));}openPrintWindow(cards);feedback("studentFeedback",`${students.length} QR ID card(s) prepared for printing.`,"success");}
 catch(e){feedback("studentFeedback",e.message,"error");}
}
async function refreshSchoolSettings(){
 if(!navigator.onLine||!api()||!$("apiToken").value.trim())return;
 try{const r=await fetch(api()+"/api/settings",{headers:headers()});if(!r.ok)throw Error("Settings request failed");const data=await r.json();if(data.schoolStartTime)$("schoolStartTime").value=data.schoolStartTime;$("schoolGraceMinutes").value=data.schoolGraceMinutes??0;}
 catch(e){console.warn(e);}
}
async function saveSchoolSettings(){
 if(!navigator.onLine||!api())return feedback("feedback","Connect to the school server to save the official arrival time.","error");
 try{const r=await fetch(api()+"/api/settings",{method:"PUT",headers:headers(),body:JSON.stringify({schoolStartTime:$("schoolStartTime").value,schoolGraceMinutes:Number($("schoolGraceMinutes").value||0)})});const data=await r.json();if(!r.ok)throw Error(data.error||"Could not save schedule");feedback("feedback","School arrival cutoff saved. Late arrival is calculated by the server.","success");}
 catch(e){feedback("feedback",e.message,"error");}
}
async function refreshPeriods(){
 if(!navigator.onLine||!api()||!$("apiToken").value.trim())return;
 try{const r=await fetch(api()+"/api/periods",{headers:headers()});if(!r.ok)throw Error("Period request failed");const data=await r.json();const tx=db.transaction("periods","readwrite");data.periods.forEach(p=>tx.objectStore("periods").put(p));}
 catch(e){console.warn(e);}
 await renderPeriods();
}
async function renderPeriods(){
 const periods=await all("periods"), select=$("periodId"), old=select.value;
 select.innerHTML='<option value="">Select a period</option>';
 periods.sort((a,b)=>a.startTime.localeCompare(b.startTime)).forEach(p=>{const o=document.createElement("option");o.value=p.periodId;o.textContent=`${p.periodName} · ${p.gradeLevel}${p.section?" / "+p.section:""} · ${p.startTime}`;select.append(o);});
 if(old)select.value=old;
 $("periodList").innerHTML="";
 periods.forEach(p=>{const d=document.createElement("div");d.className="period-item";d.textContent=`${p.periodName} — ${p.gradeLevel}${p.section?" / "+p.section:""} — ${p.subjectName||"No subject"} — ${p.startTime} to ${p.endTime} — ${p.graceMinutes} min grace`; $("periodList").append(d);});
}
async function punch(type){
 const studentId=$("studentId").value.trim(), scope=$("scope").value, periodId=scope==="CLASS"?$("periodId").value:null;
 if(!studentId)return feedback("feedback","Enter or scan a student ID.","error");
 if(scope==="CLASS"&&!periodId)return feedback("feedback","Select a class period first.","error");
 const student=await req(store("students").get(studentId));
 if(!student)return feedback("feedback","Student is not in this device's cached roster. Connect and refresh the roster, or ask the administrator to register the student.","error");
 const now=new Date();
 const event={eventId:makeUuid(),deviceId,studentId,attendanceScope:scope,periodId,eventType:type,occurredAt:now.toISOString(),schoolDate:todayManila(),syncStatus:"PENDING",metadata:{deviceId,source:"pwa"}};
 await put("events",event);$("studentId").value="";
 feedback("feedback",`${student.fullName}: ${type.replace("_"," ")} saved locally. SMS will be queued after server acceptance.`,"success");
 await render();if(navigator.onLine)syncNow();
}
async function syncNow(){
 if(!navigator.onLine)return feedback("feedback","Offline. Punches remain saved on this device.");
 if(!api()||!$("apiToken").value.trim())return feedback("feedback","Configure the API URL and device token to synchronize.");
 const pending=(await all("events")).filter(e=>e.syncStatus==="PENDING");if(!pending.length)return feedback("feedback","No pending punches to sync.","success");
 try{
  const r=await fetch(api()+"/api/sync/events",{method:"POST",headers:headers(),body:JSON.stringify({events:pending})});
  if(!r.ok)throw Error("Server returned "+r.status);
  const data=await r.json();
  for(const result of data.results||[]){const e=pending.find(x=>x.eventId===result.eventId);if(!e)continue;e.syncStatus=["ACCEPTED","ALREADY_SYNCED"].includes(result.status)?"SYNCED":result.status;e.serverResult=result;await put("events",e);}
  feedback("feedback","Sync finished. Review any DUPLICATE or REJECTED records.","success");await render();
 }catch(e){feedback("feedback","Sync failed; local punches are preserved. "+e.message,"error");}
}
async function registerStudent(){
 if(!navigator.onLine||!api())return feedback("studentFeedback","Connect to the school server before registering a student.","error");
 const payload={studentId:$("newStudentId").value.trim(),lrn:$("lrn").value.trim()||null,fullName:$("fullName").value.trim(),gradeLevel:$("grade").value,section:$("section").value.trim(),parentName:$("parentName").value.trim()||null,parentMobile:$("parentMobile").value.trim()};
 try{const r=await fetch(api()+"/api/students",{method:"POST",headers:headers(),body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||"Registration failed");feedback("studentFeedback","Student registered. Refreshing the offline roster.","success");await refreshRoster();}
 catch(e){feedback("studentFeedback",e.message,"error");}
}
async function savePeriod(){
 if(!navigator.onLine||!api())return feedback("periodFeedback","Connect to the school server to configure periods.","error");
 const payload={periodName:$("periodName").value.trim(),subjectName:$("subjectName").value.trim()||null,gradeLevel:$("periodGrade").value,section:$("periodSection").value.trim()||null,startTime:$("startTime").value,endTime:$("endTime").value,graceMinutes:Number($("graceMinutes").value||0)};
 try{const r=await fetch(api()+"/api/periods",{method:"POST",headers:headers(),body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||"Could not save period");feedback("periodFeedback","Class period saved.","success");await refreshPeriods();}
 catch(e){feedback("periodFeedback",e.message,"error");}
}
async function resolveQrValue(raw){
 const value=String(raw||"").trim();
 if(value.startsWith("JHS:")){const token=value.slice(4);const students=await all("students");const student=students.find(s=>s.qrToken===token);return student?.studentId||"";}
 return value;
}
async function scan(){
 const reader=$("qr-reader");
 if(!window.Html5Qrcode){feedback("feedback","QR scanner library did not load. Check /vendor/html5-qrcode.min.js.","error");return;}
 if(!navigator.mediaDevices?.getUserMedia){feedback("feedback","Camera access is unavailable in this browser. Use HTTPS or enter the Student ID manually.","error");return;}
 try{
  reader.hidden=false;
  if(!qrScanner)qrScanner=new Html5Qrcode("qr-reader",{verbose:true,formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE],experimentalFeatures:{useBarCodeDetectorIfSupported:false}});
  scanLoop=true;
  feedback("feedback","Starting camera. Allow permission, then center the QR code in the preview.","success");
  const cameras=await Html5Qrcode.getCameras();
  if(!cameras||!cameras.length)throw new Error("No camera was detected. Check that your webcam is connected and not being used by another app.");
  const preferred=cameras.find(c=>/back|rear|environment/i.test(c.label))||cameras[0];
  const config={fps:15,qrbox:(viewfinderWidth,viewfinderHeight)=>{
    const side=Math.floor(Math.min(viewfinderWidth,viewfinderHeight)*0.82);
    return {width:Math.max(180,side),height:Math.max(180,side)};
  },aspectRatio:1.0,disableFlip:false};
  await qrScanner.start(preferred.id,config,async decodedText=>{
   if(!scanLoop)return;
   scanLoop=false;
   feedback("feedback","QR detected. Looking up the student…","success");
   try{await qrScanner.stop();}catch{}
   reader.hidden=true;
   const studentId=await resolveQrValue(decodedText);
   if(!studentId){feedback("feedback","QR detected, but its contents do not match a student in this device's cached roster. Refresh the roster while connected to the school server.","error");return;}
   $("studentId").value=studentId;
   const students=await all("students");const student=students.find(s=>s.studentId===studentId);
   feedback("feedback",`QR recognized: ${student?.fullName||studentId} (${studentId}). Tap Time in or Time out.`,"success");
  },decodeError=>{
   // Decoder reports frequent frame misses while searching; keep scanning without flooding the UI.
  });
  feedback("feedback",`Camera active (${preferred.label||"default camera"}). Hold the QR code steady inside the large square.`,"success");
 }catch(e){scanLoop=false;try{if(qrScanner?.isScanning)await qrScanner.stop();}catch{}reader.hidden=true;feedback("feedback","Could not scan: "+(e.message||e)+". Check camera permission and try another camera if available.","error");}
}
async function stopScan(){scanLoop=false;if(qrScanner){try{if(qrScanner.isScanning)await qrScanner.stop();}catch{}try{await qrScanner.clear();}catch{}}$("qr-reader").hidden=true;}
async function init(){
 db=await openDb();$("apiUrl").value=localStorage.getItem("attendance_api_url")||"";$("apiToken").value=localStorage.getItem("attendance_api_token")||"";
 $("recordButton").onclick=()=>punch("TIME_IN");$("punchOutButton").onclick=()=>punch("TIME_OUT");$("scanButton").onclick=scan;$("syncButton").onclick=syncNow;
 $("registerStudent").onclick=registerStudent;$("savePeriod").onclick=savePeriod;$("saveSchoolSettings").onclick=saveSchoolSettings;$("refreshDashboard").onclick=refreshDashboard;$("refreshStudents").onclick=refreshRoster;$("qrGradeFilter").onchange=()=>renderStudentRoster();$("printGradeCards").onclick=printFilteredCards;
 $("saveSettings").onclick=()=>{localStorage.setItem("attendance_api_url",$("apiUrl").value.trim());localStorage.setItem("attendance_api_token",$("apiToken").value.trim());feedback("feedback","Connection settings saved.");refreshRoster();refreshPeriods();refreshSchoolSettings();syncNow();};
 window.addEventListener("online",()=>{connection();refreshRoster();refreshPeriods();refreshSchoolSettings();refreshDashboard();syncNow();});window.addEventListener("offline",connection);
 if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(console.error);
 connection();await render();await renderPeriods();await renderStudentRoster();refreshRoster();refreshPeriods();refreshSchoolSettings();refreshDashboard();
}
init().catch(e=>feedback("feedback","Initialization error: "+e.message,"error"));