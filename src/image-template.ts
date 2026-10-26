import sharp from 'sharp';
import { buildImageSkinGeometry } from './image-skin-geometry.ts';
import { buildSkinPack } from './skin-pack-files.ts';

/** A vertical two-sided poly_mesh. UVs preserve the complete image, including alpha. */
export async function createImageSkin(bytes: Uint8Array, options: {name: string; height: number}) {
  if (!Number.isFinite(options.height) || options.height < 1 || options.height > 128) throw Error('高度需为 1–128');
  if (!options.name.trim() || options.name.length > 120) throw Error('皮肤名称需为 1–120 个字符');
  const source = sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate();
  const metadata = await source.metadata();
  const dimensions = metadata.autoOrient;
  const width = options.height * dimensions.width / dimensions.height;
  if (width < 0.1 || width > 256) throw Error('图片比例过于狭长，请先裁切图片');
  // Retain original bytes; resize before encoding, without creating a full-size PNG.
  const resized = await source.toColourspace("srgb").ensureAlpha().resize(128,128,{fit:'inside',fastShrinkOnLoad:false}).raw().toBuffer({resolveWithObject:true});
  const sourceMime = ({png:"image/png",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",tiff:"image/tiff",heif:"image/avif",svg:"image/svg+xml"} as Record<string,string>)[metadata.format??""] ?? "application/octet-stream";
  const left = Math.floor((128-resized.info.width)/2), top = Math.floor((128-resized.info.height)/2);
  const png = new Uint8Array(await sharp({create:{width:128,height:128,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:resized.data,raw:{width:resized.info.width,height:resized.info.height,channels:4},left,top}]).png().toBuffer());
  const u0=left/128,u1=(left+resized.info.width)/128,v0=1-(top+resized.info.height)/128,v1=1-top/128;
  const geometry=buildImageSkinGeometry({width,height:options.height,u0,v0,u1,v1});
  return {geometry,png,sourceImage:bytes,sourceMime,width,height:options.height,files:buildSkinPack({geometry,png,identifier:'geometry.skin0',packName:options.name})};
}
