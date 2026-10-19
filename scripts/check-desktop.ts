import {documentFixture} from '../tests/fixtures.ts';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,stat} from 'node:fs/promises';
import type {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {waitForExit} from './process.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),fixture=join(root,'.cache/desktop-tests',crypto.randomUUID());
await mkdir(fixture,{recursive:true});
const textureFixture=join(fixture,'model.glb');
const doc=await documentFixture();
doc.getRoot().listMaterials()[0]!.setDoubleSided(true).setAlphaMode("OPAQUE");
// A varied texture survives preview pruning, which folds solid textures into material colors.
doc.getRoot().listTextures()[0]!.setImage(await sharp(Buffer.from('<svg width="8" height="8"><rect width="8" height="8" fill="#40a050"/><rect width="4" height="4" fill="#e0a040"/></svg>')).png().toBuffer());
await new NodeIO().write(textureFixture,doc);
const executable=process.argv[2]??((await import('electron')).default as unknown as string);
const packaged=!!process.argv[2];
const report=join(fixture,'report.json'),screenshot=join(fixture,'desktop.png');
const env:Record<string,string|undefined>={...process.env,FOURDGEN_DESKTOP_TEXTURE_FIXTURE:textureFixture,FOURDGEN_DESKTOP_SMOKE:'1',FOURDGEN_DESKTOP_SMOKE_REPORT:report,FOURDGEN_DESKTOP_SCREENSHOT:screenshot,FOURDGEN_DATA_DIR:join(fixture,'data'),FOURDGEN_DESKTOP_USER_DATA:join(fixture,'user'),SKIN_MANAGER_CONFIG:join(fixture,'no-game.json')};delete env.ELECTRON_RUN_AS_NODE;
const logFile='--log-file='+join(fixture,'electron.log');
const child=spawn(packaged?resolve(executable):executable,packaged?['--enable-logging=stderr',logFile]:[root,'--enable-logging=stderr',logFile],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
async function readAll(stream:Readable):Promise<string>{stream.setEncoding('utf8');let value='';for await(const chunk of stream)value+=chunk;return value;}
const timer=setTimeout(()=>child.kill(),120000);
try{
 const [out,error,code]=await Promise.all([readAll(child.stdout!),readAll(child.stderr!),waitForExit(child)]);
 assert.equal(code,0,out+'\n'+error);
 const result=JSON.parse(await readFile(report,'utf8'));
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.nodeExposed,false);assert.equal(result.unauthenticatedStatus,403);assert.equal(result.nativeDirectory,true);assert.equal(result.converted,true);assert.equal(result.zip,true);assert.equal(result.textured,true);assert.equal(result.appbar,true);assert.equal(result.dataRoot,join(fixture,'data'));assert.ok((await stat(screenshot)).size>1000);
 // Private desktop service must reject unauthenticated browser requests while alive; lifecycle is checked after quit.
 for(let i=0;i<20;i++){let alive=true;try{process.kill(result.backendPid,0);}catch{alive=false;}if(!alive)break;await delay(250);}
 assert.throws(()=>process.kill(result.backendPid,0));
 console.log('PASS: Electron renderer, native bridge, isolated data and backend shutdown. '+report);
 console.log('Screenshot: '+screenshot);
}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill();await waitForExit(child).catch(()=>{});}}
