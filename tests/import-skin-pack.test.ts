import {test,expect} from 'bun:test';
import sharp from 'sharp';
import {normalizeImportedPack,parsePackJSON,safeExternalAsset} from '../src/import-skin-pack.ts';
import {validateSkinPackFiles} from '../src/skin-pack.ts';
const enc=(v:any)=>new TextEncoder().encode(JSON.stringify(v));
test('external filenames remain safe while unicode and spaces are accepted',()=>{expect(safeExternalAsset('CapaHD-dream-máscara.png')).toBe(true);expect(safeExternalAsset('my skin.png')).toBe(true);for(const path of ['../a.png','a/b.png','C:a.png','CON.png'])expect(safeExternalAsset(path)).toBe(false);});
test('JSON comments and trailing commas preserve quoted strings',()=>{expect(parsePackJSON(new TextEncoder().encode('{/*x*/"url":"https://x/,}","a":[1,],}'))).toEqual({url:'https://x/,}',a:[1]});});
test('normalizes duplicate labels, disguised JPEG and legacy cubes with missing dimensions',async()=>{
 const image=await sharp({create:{width:64,height:64,channels:3,background:'red'}}).jpeg().toBuffer();
 const r=await normalizeImportedPack({'manifest.json':enc({format_version:1,header:{name:'External',uuid:crypto.randomUUID(),version:[1,0,0]},modules:[{type:'skin_pack',uuid:crypto.randomUUID(),version:[1,0,0]}]}),'skins.json':enc({skins:[{localization_name:'a.b',texture:'máscara test.png',geometry:'geometry.test'},{localization_name:'a.b',texture:'máscara test.png',geometry:'geometry.test'},{texture:'missing.png',geometry:'geometry.test'}]}),'geometry.json':new TextEncoder().encode('{"format_version":"1.10.0","geometry.test":{"bones":[{"name":"body","cubes":[{"origin":[0,0,0],"size":[1,1,1],"uv":[0,0]}]}],},}'),'máscara test.png':image});
 expect(r.warnings.length).toBe(1);expect((await validateSkinPackFiles(r.files)).skins).toBe(2);expect((await sharp(r.files['texture_0.png']).metadata()).format).toBe('png');expect(JSON.parse(new TextDecoder().decode(r.files['skins.json'])).skins[1].localization_name).toBe('skin_1');
});
