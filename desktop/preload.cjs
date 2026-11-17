const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('attendance',{call:(action,payload)=>ipcRenderer.invoke('attendance',action,payload)});
