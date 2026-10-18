import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { createImageSkin } from '../src/image-template.ts';
import { validateSkinPackFiles } from '../src/skin-pack.ts';
import { decodeGeometryTriangles } from '../src/geometry-validator.ts';

test('image template preserves portrait ratio, alpha, front orientation and valid double-sided mesh', async () => {
  const bytes=await sharp({create:{width:40,height:80,channels:4,background:{r:255,g:40,b:20,alpha:0.5}}}).png().toBuffer();
  const image=await createImageSkin(bytes,{name:'图片皮肤',height:32});
  expect(image.width).toBe(16);expect(image.height).toBe(32);
  expect((await validateSkinPackFiles(image.files)).skins).toBe(1);
  const triangles=decodeGeometryTriangles(image.geometry,'geometry.skin0');
  expect(triangles).toHaveLength(4);
  expect(triangles.filter(t=>t[0]!.normal[2]===-1)).toHaveLength(2);
  expect(triangles.filter(t=>t[0]!.normal[2]===1)).toHaveLength(2);
  const pixels=await sharp(image.png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  expect(pixels.info.width).toBe(128);expect(pixels.info.height).toBe(128);
  expect(pixels.data[3]).toBe(0); // Transparent space outside the narrow image.
  expect(pixels.data[(64*128+64)*4+3]).toBeGreaterThan(100);
  expect(pixels.data[(64*128+64)*4+3]).toBeLessThan(150);
  // Front view follows the existing Bedrock preview convention; image U grows with X.
  const mesh=image.geometry['geometry.skin0']!.bones[0]!.poly_mesh!;
  expect(mesh.uvs[0]![0]).toBeLessThan(mesh.uvs[1]![0]);
  expect(mesh.uvs[2]![1]).toBeGreaterThan(mesh.uvs[1]![1]);
});

test('image template rejects invalid data and unreasonable dimensions',async()=>{
  const bytes=await sharp({create:{width:16,height:16,channels:4,background:'#fff'}}).png().toBuffer();
  await expect(createImageSkin(bytes,{name:'test',height:0})).rejects.toThrow('高度');
  await expect(createImageSkin(bytes,{name:' ',height:32})).rejects.toThrow('名称');
  await expect(createImageSkin(new Uint8Array([1,2,3]),{name:'test',height:32})).rejects.toThrow();
});

test('template keeps original JPEG bytes and applies EXIF rotation to aspect and export',async()=>{
  const bytes=await sharp({create:{width:80,height:40,channels:3,background:'#6acb9d'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const image=await createImageSkin(bytes,{name:'rotated photo',height:32});
  expect(image.sourceImage).toBe(bytes);
  expect(image.sourceMime).toBe('image/jpeg');
  expect(image.width).toBe(16);
  expect((await validateSkinPackFiles(image.files)).skins).toBe(1);
});
