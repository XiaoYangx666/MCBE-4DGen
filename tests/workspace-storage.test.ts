import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateStorageDirectory} from '../src/workspace-storage.ts';

test('workspace relocation preserves sources, model identity, skin metadata and originals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'4d-storage-')),from=join(dir,'old'),to=join(dir,'new'),id='a'.repeat(64);
 try{
  await mkdir(join(from,'models/entries'),{recursive:true});await mkdir(join(from,'sources'),{recursive:true});await mkdir(join(from,'skins/library'),{recursive:true});
  const source=join(from,'sources/model.glb');await writeFile(source,'source');
  const entry={id,path:source,name:'model',settings:{height:32},packIds:['skin']};
  await writeFile(join(from,'models/entries',id+'.json'),JSON.stringify(entry));
  await writeFile(join(from,'skins/library/skin.json'),JSON.stringify({meta:{source}}));
  await mkdir(to);await migrateStorageDirectory(from,to);
  const moved=JSON.parse(await readFile(join(to,'models/entries',id+'.json'),'utf8'));
  expect(moved).toEqual({...entry,path:join(to,'sources/model.glb')});
  expect(await readFile(moved.path,'utf8')).toBe('source');
  expect(JSON.parse(await readFile(join(to,'skins/library/skin.json'),'utf8')).meta.source).toBe(moved.path);
  expect(await readFile(source,'utf8')).toBe('source');
  await migrateStorageDirectory(from,to); // Restart after config-save interruption is harmless.
  const occupied=join(dir,'occupied');await mkdir(occupied);await writeFile(join(occupied,'keep'),'keep');
  await expect(migrateStorageDirectory(from,occupied)).rejects.toThrow('不为空');
  await expect(migrateStorageDirectory(from,join(from,'child'))).rejects.toThrow('包含');
 }finally{await rm(dir,{recursive:true,force:true});}
});
