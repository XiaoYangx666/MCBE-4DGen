import {build} from 'vite';
import {spawn} from 'node:child_process';
import {cp,mkdir,copyFile,writeFile,readFile,rm,stat,readdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {waitForExit} from './process.ts';
if(process.platform!=='win32')throw Error('Windows 便携版请在 Windows 构建');
const keepLocales=new Set(['en-US.pak','zh-CN.pak','zh-TW.pak']);
async function pruneRuntime(dir:string):Promise<void>{
  let entries;
  try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
    const full=join(dir,entry.name);
    if(entry.isDirectory()){
      if(entry.name==='@types'||entry.name==='.bin'||entry.name==='.cache'){await rm(full,{recursive:true,force:true});continue;}
      await pruneRuntime(full);
      continue;
    }
    const name=entry.name.toLowerCase();
    if(name.endsWith('.map')||name.endsWith('.d.ts')||name.endsWith('.d.mts')||name.endsWith('.d.cts')){await rm(full,{force:true});continue;}
    if(name.endsWith('.md')&&!/^(license|notice|copying|third[-_]?party)/.test(name))await rm(full,{force:true});
  }
}
async function directorySize(dir:string):Promise<number>{
  let total=0;
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=join(dir,entry.name);
    if(entry.isDirectory())total+=await directorySize(full);
    else total+=(await stat(full)).size;
  }
  return total;
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),stage=join(root,'.cache/desktop-package-'+crypto.randomUUID()),payload=join(stage,'payload');
const outFlag=process.argv.indexOf('--out'),outValue=outFlag>=0?process.argv[outFlag+1]:process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
const outDir=resolve(root,outValue??process.env.FOURDGEN_RELEASE_DIR??'release');
await mkdir(payload,{recursive:true});
try{
 await cp(join(root,'desktop'),join(stage,'desktop'),{recursive:true});
 for(const folder of ['server','src','profiles'])await cp(join(root,folder),join(payload,folder),{recursive:true});
 for(const name of ['package.json','bun.lock'])await copyFile(join(root,name),join(payload,name));
 await writeFile(join(stage,'package.json'),JSON.stringify({name:'4dgen',productName:'4DGen',version:'0.0.1',main:'desktop/main.cjs',private:true}));
 console.log('Building desktop UI…');
 await build({root:join(root,'web'),configFile:false,logLevel:'warn',build:{outDir:join(payload,'web-dist'),emptyOutDir:true}});
 console.log('Installing production dependencies…');
 const install=spawn(process.env.BUN_BINARY??'bun',['install','--production','--frozen-lockfile','--ignore-scripts'],{cwd:payload,stdio:'inherit'});
 if(await waitForExit(install)!==0)throw Error('生产依赖安装失败');
 const svg=await readFile(join(root,'desktop/icon.svg'));
 const png=await sharp(svg).resize(256,256).png().toBuffer();
 const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
 const icon=join(stage,'icon.ico');await writeFile(icon,Buffer.concat([header,png]));
 const electronVersion=JSON.parse(await readFile(join(root,'node_modules/electron/package.json'),'utf8')).version;
 console.log('Packaging 4DGen for Windows…');
 const electronZipDir=join(root,'.cache/electron-runtime');
 const hasElectronZip=await stat(join(electronZipDir,`electron-v${electronVersion}-win32-x64.zip`)).then(()=>true).catch(()=>false);
 const options={dir:stage,out:outDir,name:'4DGen',executableName:'4DGen',platform:'win32',arch:'x64',electronVersion,...(hasElectronZip?{electronZipDir}:{}),icon,asar:true,extraResource:[payload],overwrite:true,prune:false,win32metadata:{CompanyName:'4DGen',FileDescription:'4DGen 模型与皮肤工作台',ProductName:'4DGen'}};
 const optionsPath=join(root,'.cache/desktop-package-options-'+crypto.randomUUID()+'.json');
 await writeFile(optionsPath,JSON.stringify(options));
 try {const child=spawn(process.execPath,[join(root,'scripts/package-electron.mjs'),optionsPath],{stdio:'inherit'});if(await waitForExit(child)!==0)throw Error('Electron packaging failed');} finally {await rm(optionsPath,{force:true});}
  const appDir=join(outDir,'4DGen-win32-x64');
  const locales=join(appDir,'locales');
  for(const name of await readdir(locales).catch(()=>[] as string[]))if(!keepLocales.has(name))await rm(join(locales,name),{force:true});
  await pruneRuntime(join(appDir,'resources','payload','node_modules'));
  await rm(join(appDir,'resources','payload','bun.lock'),{force:true});
  console.log('便携版输出：'+outDir);
  console.log('便携版大小：'+(await directorySize(appDir)/1024/1024).toFixed(1)+' MB');
  console.log('如果双击 exe 没有窗口，请把整个目录复制到工作区外，或用 --out 指定普通可写目录。');

}finally{if(!stage.startsWith(join(root,'.cache')+'\\'))throw Error('Unexpected staging directory');await rm(stage,{recursive:true,force:true});}
