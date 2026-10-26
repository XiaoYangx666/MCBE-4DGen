/** Isolated HTTP smoke test: storage + template + offline library + archive. */
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,readFile,realpath,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import JSZip from 'jszip';
import assert from 'node:assert/strict';
import {waitForExit} from '../lib/process.ts';
const fixture=await realpath(await mkdtemp(join(tmpdir(),'4d-studio-')));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),port=4187,base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/start.ts'],{cwd:root,env:{...process.env,PORT:String(port),FOURDGEN_DATA_DIR:join(fixture,'data'),SKIN_MANAGER_CONFIG:join(fixture,'missing-config.json')},stdio:['ignore','pipe','inherit']});
try {
  child.stdout!.setEncoding('utf8');let output='';
  await new Promise<void>((ready,failed)=>{
    const onData=(chunk:string)=>{output+=chunk;if(output.includes('本地工作台')){child.stdout!.off('data',onData);child.stdout!.resume();ready();}};
    child.stdout!.on('data',onData);
    child.once('error',failed);
    child.once('exit',code=>failed(Error('Server stopped: '+output)));
  });
  const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});const v:any=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
  const storage:any=await(await fetch(base+'/api/storage')).json();assert.equal(storage.root,join(fixture,'data'));
  const missingJob=await fetch(base+'/api/job/does-not-exist');assert.equal(missingJob.status,404);
  const image=await sharp({create:{width:60,height:120,channels:4,background:{r:40,g:180,b:100,alpha:0.7}}}).png().toBuffer();
  const form=new FormData();form.append('image',new File([image],'测试.png'));form.append('name','图片模板验证');form.append('height','32');
  const response=await fetch(base+'/api/templates/image',{method:'POST',headers:{Origin:base},body:form});const result:any=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.width,16);
  assert.ok(result.source.startsWith(storage.sources));assert.ok((await readFile(result.source)).length);
  const scene:any=await(await fetch(base+'/api/job/'+result.id+'/scene')).json();assert.ok(scene.geometry['geometry.skin0']);
  const saved=await post('/api/packs/install',{job:result.id,label:'图片模板验证'});
  const packs:any=await(await fetch(base+'/api/packs')).json();assert.equal(packs.configured,true);assert.equal(packs.gameConfigured,false);assert.equal(packs.stateDir,storage.skins);assert.equal(packs.status.length,0);
  assert.equal(packs.library.find((p:any)=>p.id===saved.pack.id).stats.triangles,4);
  const download=await fetch(base+'/api/packs/'+saved.pack.id+'/download');assert.equal(download.status,200);
  assert.equal(download.headers.get('Content-Type'),'application/zip');assert.match(download.headers.get('Content-Disposition')??'',/filename\*=UTF-8''/);
  const jobDownload=await fetch(base+'/api/job/'+result.id+'/download');assert.equal(jobDownload.status,200);assert.match(jobDownload.headers.get('Content-Disposition')??'',/filename\*=UTF-8''/);
  const jobZip=await JSZip.loadAsync(await jobDownload.arrayBuffer());assert.ok(jobZip.file('geometry.json'));assert.ok(jobZip.file('skin0.png'));
  const zip=await JSZip.loadAsync(await download.arrayBuffer());assert.ok(zip.file('geometry.json'));assert.ok(zip.file('skin0.png'));
  const blocked=await fetch(base+'/api/packs/enable',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({slot:'custom',id:saved.pack.id})});assert.equal(blocked.status,400);
  await writeFile(join(fixture,'model.obj'),'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model=await post('/api/local-import',{path:join(fixture,'model.obj')});
  const models:any=await(await fetch(base+'/api/models')).json();const entry=models.find((m:any)=>m.id===model.modelId);assert.ok(entry.path.startsWith(storage.sources));
  const convert=await post('/api/convert',{session:model.id,excluded:[],binding:'static',ratio:1,maxError:0.03,height:32,profile:null});
  let converted:any=null;for(let i=0;i<200;i++){converted=await(await fetch(base+'/api/job/'+convert.id)).json();if(converted.status!=='running')break;await new Promise(r=>setTimeout(r,25));}
  assert.equal(converted.status,'done',JSON.stringify(converted));
  const convertedDownload=await fetch(base+'/api/job/'+convert.id+'/download');
  assert.match(convertedDownload.headers.get('Content-Disposition')??'',/filename="model\.zip"/);
  const convertedZip=await JSZip.loadAsync(await convertedDownload.arrayBuffer());
  assert.equal(JSON.parse(await convertedZip.file('manifest.json')!.async('string')).header.name,'model');
  const settings:any=await(await fetch(base+'/api/settings')).json();assert.equal(settings.dataRoot,storage.root);
  const usage:any=await(await fetch(base+'/api/settings/storage-usage')).json();assert.equal(usage.root,storage.root);assert.ok(usage.bytes>0);assert.ok(usage.categories.skins.bytes>0);assert.ok(usage.categories.sources.bytes>0);
  const gameRoot=join(fixture,'game');await mkdir(join(gameRoot,'custom'),{recursive:true});
  for(const asset of Object.values(zip.files)){if(asset.dir)continue;const target=join(gameRoot,'custom',asset.name);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,await asset.async('uint8array'));}
  await post('/api/settings/game-directory',{path:gameRoot});
  await post('/api/packs/edit-installed',{slot:'custom',name:'游戏包名',skinIndex:0,skinName:'游戏皮肤名'});
  const gameContents:any=await(await fetch(base+'/api/preset-packs/custom/skins')).json();assert.equal(gameContents.name,'游戏包名');assert.equal(gameContents.skins[0].name,'游戏皮肤名');
  const gameExport=await fetch(base+'/api/preset-packs/custom/export?skins=0&name='+encodeURIComponent('游戏导出'));
  assert.equal(gameExport.status,200);assert.match(gameExport.headers.get('Content-Disposition')??'',/filename\*=UTF-8''/);
  const gameZip=await JSZip.loadAsync(await gameExport.arrayBuffer());
  const gameSkins=JSON.parse(await gameZip.file('skins.json')!.async('string'));
  assert.equal(gameSkins.skins.length,1);assert.equal(JSON.parse(await gameZip.file('manifest.json')!.async('string')).header.name,'游戏导出');
  assert.equal((await fetch(base+'/api/preset-packs/custom/export?skins=9')).status,400);
  await post('/api/packs/edit-installed',{slot:'custom',skinIndex:0,remove:true,revision:gameContents.revision});
  assert.equal(((await(await fetch(base+'/api/preset-packs/custom/skins')).json()) as any).skins.length,0);
  await post('/api/packs/restore',{slot:'custom'});
  assert.equal(((await(await fetch(base+'/api/preset-packs/custom/skins')).json()) as any).skins.length,1);
  assert.equal(((await(await fetch(base+'/api/packs/'+saved.pack.id+'/skins')).json()) as any).skins.length,1);
  await post('/api/models/delete',{id:model.modelId,deleteSource:true});assert.ok((await stat(join(fixture,'model.obj'))).isFile());await assert.rejects(stat(entry.path));
  if(process.argv.includes('--browser')) {const p=spawn(process.execPath,[process.env.STUDIO_BROWSER_TEST!],{env:{...process.env,STUDIO_BASE:base,STUDIO_FIXTURE:fixture},stdio:'inherit'});assert.equal(await waitForExit(p),0);}
  console.log('PASS: unified model/image/skin storage, offline template save, 4 triangles, archive and game-write guard');
} finally {child.kill();await waitForExit(child).catch(()=>{});await rm(fixture,{recursive:true,force:true});}
