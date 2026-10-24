import { buildSkinPack } from '../../src/skin-pack-files.ts';
import type { BedrockGeometryFile, VertexRef } from '../../src/bedrock-types.ts';
import { canvasPng, validateName } from './convert.ts';

export interface ImageSkinOptions {
  name: string;
  height: number;
}

export interface ImageSkinResult {
  files: Record<string, Uint8Array>;
  png: Uint8Array;
  pngUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  triangles: number;
}

/** Create the same vertical double-sided flat skin as the desktop image template, fully in-canvas. */
export async function createImageSkin(file: Blob, options: ImageSkinOptions): Promise<ImageSkinResult> {
  validateName(options.name);
  if (!Number.isFinite(options.height) || options.height < 1 || options.height > 128)
    throw new Error('皮肤高度需在 1–128 之间');
  if (file.size > 40 * 1024 * 1024)
    throw new Error('图片超过 40 MB，请先压缩后再试');

  const decoded = await decodeImage(file);
  try {
    const aspect = decoded.width / decoded.height;
    if (!(aspect > 0) || !Number.isFinite(aspect))
      throw new Error('图片尺寸无效');
    const width = options.height * aspect;
    if (width < 0.1 || width > 256)
      throw new Error('图片比例过于狭长，请先裁切图片');

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建 2D 画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = Math.min(128 / decoded.width, 128 / decoded.height);
    const drawWidth = Math.max(1, Math.min(128, Math.round(decoded.width * scale)));
    const drawHeight = Math.max(1, Math.min(128, Math.round(decoded.height * scale)));
    const left = Math.floor((128 - drawWidth) / 2);
    const top = Math.floor((128 - drawHeight) / 2);
    context.clearRect(0, 0, 128, 128);
    context.drawImage(decoded.image, left, top, drawWidth, drawHeight);

    const u0 = left / 128, u1 = (left + drawWidth) / 128;
    const v0 = 1 - (top + drawHeight) / 128, v1 = 1 - top / 128;
    const refs = (a: number, b: number, c: number, n: number): [VertexRef, VertexRef, VertexRef] =>
      [[a, n, a], [b, n, b], [c, n, c]];
    const geometry: BedrockGeometryFile = {
      format_version: '1.8.0',
      'geometry.skin0': {
        texturewidth: 128,
        textureheight: 128,
        visible_bounds_width: Math.max(width, options.height) / 16 + 1,
        visible_bounds_height: options.height / 16 + 1,
        visible_bounds_offset: [0, options.height / 32, 0],
        bones: [{
          name: 'body',
          pivot: [0, 24, 0],
          poly_mesh: {
            normalized_uvs: true,
            positions: [
              [-width / 2, 0, 0], [width / 2, 0, 0],
              [width / 2, options.height, 0], [-width / 2, options.height, 0],
            ],
            normals: [[0, 0, -1], [0, 0, 1]],
            uvs: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
            polys: [
              refs(0, 2, 1, 0),
              refs(0, 3, 2, 0),
              refs(0, 1, 2, 1),
              refs(0, 2, 3, 1),
            ],
          },
        }],
      },
    };
    const png = await canvasPng(canvas);
    const files = buildSkinPack({
      geometry,
      png,
      identifier: 'geometry.skin0',
      packName: options.name.trim(),
    });
    return {
      files,
      png,
      pngUrl: canvas.toDataURL('image/png'),
      width,
      height: options.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      triangles: 4,
    };
  } finally {
    decoded.release();
  }
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch { /* fall back to an <img> for SVG or unsupported types */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error('无法读取图片，请换一张 PNG、JPEG、WebP 或 SVG 图片。');
  }
}
