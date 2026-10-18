import sharp from 'sharp';
import type { BedrockGeometryFile, VertexRef } from './bedrock-types.ts';
import { buildSkinPack } from './skin-pack.ts';

/** A vertical two-sided poly_mesh. UVs preserve the complete image, including alpha. */
export async function createImageSkin(bytes: Uint8Array, options: {name: string; height: number}) {
  if (!Number.isFinite(options.height) || options.height < 1 || options.height > 128) throw Error('高度需为 1–128');
  if (!options.name.trim() || options.name.length > 120) throw Error('皮肤名称需为 1–120 个字符');
  const source = sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate();
  const oriented = await source.ensureAlpha().png().toBuffer({resolveWithObject:true});
  const width = options.height * oriented.info.width / oriented.info.height;
  if (width < 0.1 || width > 256) throw Error('图片比例过于狭长，请先裁切图片');
  const resized = await sharp(oriented.data).resize(128,128,{fit:'inside'}).png().toBuffer({resolveWithObject:true});
  const left = Math.floor((128-resized.info.width)/2), top = Math.floor((128-resized.info.height)/2);
  const png = new Uint8Array(await sharp({create:{width:128,height:128,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:resized.data,left,top}]).png().toBuffer());
  const u0=left/128,u1=(left+resized.info.width)/128,v0=1-(top+resized.info.height)/128,v1=1-top/128;
  const refs=(a:number,b:number,c:number,n:number):[VertexRef,VertexRef,VertexRef]=>[[a,n,a],[b,n,b],[c,n,c]];
  const geometry:BedrockGeometryFile={format_version:'1.8.0','geometry.skin0':{
    texturewidth:128,textureheight:128,visible_bounds_width:Math.max(width,options.height)/16+1,visible_bounds_height:options.height/16+1,visible_bounds_offset:[0,options.height/32,0],
    bones:[{name:'body',pivot:[0,24,0],poly_mesh:{normalized_uvs:true,
      positions:[[-width/2,0,0],[width/2,0,0],[width/2,options.height,0],[-width/2,options.height,0]],
      normals:[[0,0,-1],[0,0,1]],uvs:[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],
      polys:[refs(0,2,1,0),refs(0,3,2,0),refs(0,1,2,1),refs(0,2,3,1)],
    }}],
  }};
  return {geometry,png,sourcePng:new Uint8Array(oriented.data),width,height:options.height,files:buildSkinPack({geometry,png,identifier:'geometry.skin0',packName:options.name})};
}
