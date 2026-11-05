import { buildSkinPack } from '../../src/skin-pack-files.ts';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import { removeSolidBackground } from '../../src/image-cutout.ts';
import { buildImageSkinGeometry } from '../../src/image-skin-geometry.ts';
import { canvasPng } from './canvas.ts';
import { validateName } from './names.ts';

export interface ImageSkinOptions {
  name: string;
  height: number;
  cutout?: { enabled: boolean; tolerance: number };
}

export interface ImageSkinResult {
  files: Record<string, Uint8Array>;
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  pngUrl: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  triangles: number;
  /** Share of the source image that became transparent, 0–1. */
  backgroundRemoved: number;
  /** Whether a solid background was found and removed. */
  backgroundDetected: boolean;
}

export interface CutoutPreview {
  url: string;
  removedRatio: number;
  detected: boolean;
  width: number;
  height: number;
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

    const scale = Math.min(128 / decoded.width, 128 / decoded.height);
    const drawWidth = Math.max(1, Math.min(128, Math.round(decoded.width * scale)));
    const drawHeight = Math.max(1, Math.min(128, Math.round(decoded.height * scale)));
    const left = Math.floor((128 - drawWidth) / 2);
    const top = Math.floor((128 - drawHeight) / 2);

    // Cut out before centering so the detector sees the image's own border, not
    // the transparent padding around it.
    const image = document.createElement('canvas');
    image.width = drawWidth;
    image.height = drawHeight;
    const imageContext = image.getContext('2d');
    if (!imageContext) throw new Error('当前浏览器无法创建 2D 画布');
    imageContext.imageSmoothingEnabled = true;
    imageContext.imageSmoothingQuality = 'high';
    imageContext.drawImage(decoded.image, 0, 0, drawWidth, drawHeight);

    let backgroundRemoved = 0;
    let backgroundDetected = false;
    if (options.cutout?.enabled) {
      const pixels = imageContext.getImageData(0, 0, drawWidth, drawHeight);
      const result = removeSolidBackground(
        { data: pixels.data, width: drawWidth, height: drawHeight },
        { tolerance: options.cutout.tolerance },
      );
      imageContext.putImageData(pixels, 0, 0);
      backgroundRemoved = result.removedRatio;
      backgroundDetected = result.detected;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建 2D 画布');
    context.clearRect(0, 0, 128, 128);
    context.drawImage(image, left, top);

    const u0 = left / 128, u1 = (left + drawWidth) / 128;
    const v0 = 1 - (top + drawHeight) / 128, v1 = 1 - top / 128;
    const geometry = buildImageSkinGeometry({ width, height: options.height, u0, v0, u1, v1 });
    const png = await canvasPng(canvas);
    const files = buildSkinPack({
      geometry,
      png,
      identifier: 'geometry.skin0',
      packName: options.name.trim(),
    });
    return {
      files,
      geometry,
      png,
      pngUrl: canvas.toDataURL('image/png'),
      width,
      height: options.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      triangles: 4,
      backgroundRemoved,
      backgroundDetected,
    };
  } finally {
    decoded.release();
  }
}

/** Larger on-screen preview using the exact same cutout algorithm as generation. */
export async function previewImageCutout(
  file: Blob,
  options: { tolerance: number; maxSize?: number },
): Promise<CutoutPreview> {
  const decoded = await decodeImage(file);
  try {
    const maxSize = options.maxSize ?? 384;
    const scale = Math.min(1, maxSize / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建 2D 画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const result = removeSolidBackground(
      { data: pixels.data, width, height },
      { tolerance: options.tolerance },
    );
    context.putImageData(pixels, 0, 0);
    return {
      url: canvas.toDataURL('image/png'),
      removedRatio: result.removedRatio,
      detected: result.detected,
      width,
      height,
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
