const {app,BrowserWindow,dialog,ipcMain,shell,Menu,nativeTheme,screen}=require('electron');
const {spawn}=require('node:child_process');
const {join,resolve}=require('node:path');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const readline=require('node:readline');
const packaged=app.isPackaged;
const resourceRoot=process.resourcesPath;
app.setName('4DGen');
app.setPath('userData',join(app.getPath('appData'),'4DGen'));
let window,backend,origin,quitting=false,tail='';
const smoke=process.env.FOURDGEN_DESKTOP_SMOKE;
const smokeFile=process.env.FOURDGEN_DESKTOP_SMOKE_REPORT;
if(smoke&&process.env.FOURDGEN_DESKTOP_USER_DATA)app.setPath('userData',process.env.FOURDGEN_DESKTOP_USER_DATA);
function report(value){if(smokeFile)fs.writeFileSync(smokeFile,JSON.stringify(value,null,2));}
try{fs.mkdirSync(app.getPath('userData'),{recursive:true});}catch{}
const gotLock=app.requestSingleInstanceLock();
if(!gotLock)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
function trusted(event){if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!origin||new URL(event.senderFrame.url).origin!==origin)throw Error('Untrusted desktop request');}
function stopBackend(){if(backend&&!backend.killed)backend.kill();}
function external(url){try{const target=new URL(url);if(['https:','http:'].includes(target.protocol))void shell.openExternal(target.href);}catch{}}
async function start(){
  const appRoot=app.getAppPath();
  const root=packaged?join(resourceRoot,'payload'):resolve(appRoot);
  const token=randomBytes(32).toString('hex');
  const logFile=join(app.getPath('userData'),'desktop.log');fs.mkdirSync(app.getPath('userData'),{recursive:true});
  function log(chunk){tail=(tail+chunk).slice(-12000);fs.appendFileSync(logFile,chunk);}
  const configDir=app.getPath('userData');
  if(!packaged&&!smoke&&!process.env.FOURDGEN_DATA_DIR){
    const workspaceConfig=join(root,'storage.local.json'),desktopConfig=join(configDir,'storage.local.json');
    if(!fs.existsSync(desktopConfig)){
      const previous=fs.existsSync(workspaceConfig)?JSON.parse(fs.readFileSync(workspaceConfig,'utf8')):{dataDir:'4dgen-data'};
      const dataDir=resolve(root,previous.dataDir);
      if(fs.existsSync(dataDir))fs.writeFileSync(desktopConfig,JSON.stringify({dataDir,...(previous.migrateFrom?{migrateFrom:resolve(root,previous.migrateFrom)}:{})},null,2));
    }
    const gameConfig=join(configDir,'skin-manager.local.json');
    if(!fs.existsSync(gameConfig)&&fs.existsSync(join(root,'skin-manager.local.json'))){
      const previous=JSON.parse(fs.readFileSync(join(root,'skin-manager.local.json'),'utf8'));
      fs.writeFileSync(gameConfig,JSON.stringify({...previous,skinPacksRoot:resolve(root,previous.skinPacksRoot),stateDir:resolve(root,previous.stateDir)},null,2));
    }
  }
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:'0',FOURDGEN_DESKTOP_TOKEN:token,FOURDGEN_DESKTOP:'1',FOURDGEN_PARENT_PID:String(process.pid),FOURDGEN_CONFIG_DIR:configDir,FOURDGEN_DEFAULT_DATA_DIR:join(configDir,'data'),SKIN_MANAGER_CONFIG:process.env.SKIN_MANAGER_CONFIG??join(configDir,'skin-manager.local.json')};
  if(packaged){env.FOURDGEN_CONFIG_DIR=app.getPath('userData');env.FOURDGEN_DEFAULT_DATA_DIR=join(app.getPath('userData'),'data');env.FOURDGEN_WEB_DIST=join(root,'web-dist');env.FOURDGEN_SKIP_WEB_BUILD='1';}
  backend=spawn(process.execPath,['server/start.ts'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  backend.stdout.on('data',chunk=>log(chunk.toString()));backend.stderr.on('data',chunk=>log(chunk.toString()));
  const ready=await new Promise((accept,reject)=>{
    const timer=setTimeout(()=>reject(Error('后台服务启动超时。'+tail)),120000);
    const lines=readline.createInterface({input:backend.stdout});
    lines.on('line',line=>{const match=line.match(/4DGEN_READY (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);lines.close();accept(match[1]);}});
    backend.once('error',e=>{clearTimeout(timer);reject(e);});
    backend.once('exit',code=>{clearTimeout(timer);reject(Error('后台服务已退出（'+code+'）。'+tail));});
  });
  if(quitting)return;
  origin=ready;
  const appearanceFile=join(configDir,'appearance.json');
  let appearance='system',palette='graphite';
  try{const saved=JSON.parse(fs.readFileSync(appearanceFile,'utf8'));if(['system','light','dark'].includes(saved.theme))appearance=saved.theme;if(['graphite','ocean','sand','rose','violet'].includes(saved.palette))palette=saved.palette;}catch{}
  ipcMain.handle('desktop:palette',(event,value)=>{
    trusted(event);
    if(value!==undefined){
      if(!['graphite','ocean','sand','rose','violet'].includes(value))throw Error('Invalid palette');
      fs.writeFileSync(appearanceFile,JSON.stringify({theme:appearance,palette:value}));palette=value;
    }
    return palette;
  });
  nativeTheme.themeSource=appearance;
  ipcMain.handle('desktop:appearance', (event,value)=>{
    trusted(event);
    if(value!==undefined){
      if(!['system','light','dark'].includes(value))throw Error('Invalid appearance');
      fs.writeFileSync(appearanceFile,JSON.stringify({theme:value,palette}));
      appearance=value;nativeTheme.themeSource=value;
      window.setBackgroundColor(nativeTheme.shouldUseDarkColors?'#17191f':'#f3f5fa');
    }
    return appearance;
  });
  const area=screen.getPrimaryDisplay().workAreaSize;
  const initialWidth=Math.min(1280,area.width-48),initialHeight=Math.min(820,area.height-48);
  window=new BrowserWindow({frame:false,roundedCorners:true,thickFrame:true,width:initialWidth,height:initialHeight,minWidth:Math.min(900,initialWidth),minHeight:Math.min(600,initialHeight),show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#17191f':'#f3f5fa',title:'4DGen',webPreferences:{preload:join(appRoot,'desktop/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const session=window.webContents.session;
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  await session.cookies.set({url:origin,name:'4dgen_session',value:token,httpOnly:true,sameSite:'strict'});
  session.webRequest.onHeadersReceived((details,callback)=>{
    const headers={...details.responseHeaders};
    if(details.url.startsWith(origin+'/'))headers['Content-Security-Policy']=["default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"];
    callback({responseHeaders:headers});
  });
  window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();external(url);}});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  backend.on('exit',code=>{if(!quitting){report({ok:false,error:'Backend exited',code,tail});dialog.showErrorBox('4DGen 后台服务已停止',tail);app.quit();}});
  ipcMain.handle('desktop:choose-directory',async(event,value)=>{
    trusted(event);if(!value||!['game','data'].includes(value.kind)||typeof value.initial!=='string')throw Error('目录参数无效');
    const result=await dialog.showOpenDialog(window,{title:value.kind==='game'?'选择 Minecraft skin_packs 目录':'选择数据目录',defaultPath:value.initial||app.getPath('documents'),properties:['openDirectory','createDirectory'],buttonLabel:'选择此文件夹'});
    return {path:result.canceled?null:result.filePaths[0]??null};
  });
  ipcMain.handle('desktop:restart',event=>{trusted(event);setImmediate(()=>{app.relaunch();app.quit();});return true;});
  const template=[{label:'4DGen',submenu:[{label:'设置',click:()=>void window.loadURL(origin+'/#/settings')},{label:'重新启动',click:()=>{app.relaunch();app.quit();}},{type:'separator'},{role:'quit',label:'退出'}]},{label:'视图',submenu:[{role:'reload',label:'刷新界面'},{role:'togglefullscreen',label:'全屏'},{role:'resetzoom',label:'实际大小'},{role:'zoomin',label:'放大'},{role:'zoomout',label:'缩小'},...(!packaged?[{role:'toggleDevTools',label:'开发者工具'}]:[])]}];
  Menu.setApplicationMenu(null);
  window.setMenu(null);
  const popup=Menu.buildFromTemplate(template);
  const state=()=>({maximized:window.isMaximized(),fullscreen:window.isFullScreen(),focused:window.isFocused()});
  ipcMain.handle('desktop:window-state',event=>{trusted(event);return state();});
  ipcMain.handle('desktop:window-action',(event,action)=>{
    trusted(event);
    switch(action){
      case 'minimize':window.minimize();break;
      case 'maximize':window.isMaximized()?window.unmaximize():window.maximize();break;
      case 'close':window.close();break;
      case 'menu':popup.popup({window});break;
      default:throw Error('窗口操作无效');
    }
  });
  for(const event of ['maximize','unmaximize','enter-full-screen','leave-full-screen','focus','blur'])window.on(event,()=>window.webContents.send('desktop:window-state',state()));
  window.webContents.on('will-prevent-unload',event=>{
    const answer=dialog.showMessageBoxSync(window,{type:'question',buttons:['继续编辑','放弃未保存的修改'],defaultId:0,cancelId:0,message:'当前修改尚未保存，确定离开吗？'});
    if(answer===1)event.preventDefault();
  });
  await window.loadURL(origin+'/#/models');if(!smoke)window.show();
  if(smoke){
    const options={textureFixture:fs.readFileSync(process.env.FOURDGEN_DESKTOP_TEXTURE_FIXTURE).toString('base64')};
    const result=await window.webContents.executeJavaScript('('+require('./smoke.cjs').toString()+')('+JSON.stringify(options)+')');
    const unauthenticatedStatus=(await fetch(origin+'/api/settings')).status;
    report({ok:result.nativeDirectory&&!result.nodeExposed&&unauthenticatedStatus===403,...result,unauthenticatedStatus,origin,backendPid:backend.pid});
    if(process.env.FOURDGEN_DESKTOP_SCREENSHOT){const shot=await window.webContents.capturePage();fs.writeFileSync(process.env.FOURDGEN_DESKTOP_SCREENSHOT,shot.toPNG());}
    app.quit();
  }
}
app.on('before-quit',()=>{quitting=true;stopBackend();});
process.on('exit',stopBackend);
app.on('window-all-closed',()=>app.quit());
if(gotLock)app.whenReady().then(start).catch(error=>{report({ok:false,error:String(error),tail});if(!smoke)dialog.showErrorBox('4DGen 启动失败',String(error)+'\n日志：'+join(app.getPath('userData'),'desktop.log'));app.quit();});
