const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',Object.freeze({
  chooseDirectory:(kind,initial)=>ipcRenderer.invoke('desktop:choose-directory',{kind,initial}),
  windowState:()=>ipcRenderer.invoke('desktop:window-state'),
  windowAction:action=>ipcRenderer.invoke('desktop:window-action',action),
  onWindowState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('desktop:window-state',listener);return ()=>ipcRenderer.removeListener('desktop:window-state',listener);},
  onAbout:callback=>{const listener=()=>callback();ipcRenderer.on('desktop:about',listener);return ()=>ipcRenderer.removeListener('desktop:about',listener);},
  palette:value=>ipcRenderer.invoke('desktop:palette',value),
  appearance:value=>ipcRenderer.invoke('desktop:appearance',value),
  restart:()=>ipcRenderer.invoke('desktop:restart'),
}));
