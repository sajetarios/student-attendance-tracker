'use strict';
const {app,BrowserWindow,ipcMain,safeStorage,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {Attendance,ORIGIN}=require('./core.cjs');
app.setName('Student Attendance Tracker');
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(()=>{
 const file=path.join(app.getPath('userData'),'attendance-v1.encrypted');
 const ui=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
 const storageReady=()=>{if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('Secure operating-system storage is unavailable. Unlock your system keychain and restart.');};
 let service;let startupError;
 try{storageReady();service=new Attendance({read:()=>fs.existsSync(file)?JSON.parse(safeStorage.decryptString(fs.readFileSync(file))):null,write:data=>{storageReady();fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,safeStorage.encryptString(JSON.stringify(data)),{mode:0o600,flush:true});fs.renameSync(tmp,file);},request:async(route,{method='GET',token,body}={})=>{
  let response;try{response=await fetch(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000),redirect:'error'});}catch{throw Error('Server unavailable. Use offline unlock after initial setup; unsynced attendance remains on this computer.');}
  const data=await response.json();if(!response.ok)throw Error(response.status===401?'Session expired. Lock and sign in online again; attendance is preserved.':data.error||`Server error ${response.status}`);return data;
 }});}catch(e){startupError=e.message;}
 let queue=Promise.resolve();
 ipcMain.handle('attendance',async(event,action,payload)=>{
  if(event.senderFrame.url!==ui)throw Error('Untrusted window.');
  if(action==='portal'){await shell.openExternal(ORIGIN+'/portal-login.html');return {ok:true};}
  if(startupError)return {ok:false,error:startupError};
  if(!['login','refresh','record','sync','snapshot','lock'].includes(action))return {ok:false,error:'Unknown action'};
  const work=queue.then(async()=>{try{return {ok:true,data:await service[action](payload)};}catch(e){return {ok:false,error:e.message};}});queue=work.catch(()=>{});return work;
 });
 function create(){const w=new BrowserWindow({width:1180,height:850,minWidth:800,minHeight:640,backgroundColor:'#f4f6fb',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});w.removeMenu();w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());w.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));w.loadURL(ui);return w;}
 let win=create();app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.focus();}});app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)win=create();});
});
app.on('window-all-closed',()=>app.quit());
