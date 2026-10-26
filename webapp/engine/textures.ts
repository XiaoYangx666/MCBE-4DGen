import { decodeTGA } from '../../src/tga.ts';

/** The exported atlas is 128 px, so very large MMD textures only cost time. */
const MAX_TEXTURE_SIZE = 1024;

export interface PreparedTextures {
  files: File[];
  warnings: string[];
}

export interface TextureOptions {
  onProgress?: (done: number, total: number) => void;
}

/**
 * Browsers cannot decode TGA, which is common in MMD/PMX packs. Convert those
 * textures to PNG in place (same name and relative path) before the model
 * loader resolves them.
 */
export async function convertTgaTextures(
  files: File[],
  options: TextureOptions = {},
): Promise<PreparedTextures> {
  const converted: File[] = [];
  const warnings: string[] = [];
  const total = files.filter((file) => /\.tga$/i.test(file.name)).length;
  let done = 0;
  for (const file of files) {
    if (!/\.tga$/i.test(file.name)) {
      converted.push(file);
      continue;
    }
    options.onProgress?.(done, total);
    try {
      converted.push(await tgaToPng(file));
    } catch (cause) {
      warnings.push(
        `TGA 贴图「${file.name}」无法转换：${cause instanceof Error ? cause.message : String(cause)}`,
      );
      converted.push(file);
    }
    done += 1;
  }
  options.onProgress?.(done, total);
  return { files: converted, warnings };
}

async function tgaToPng(file: File): Promise<File> {
  const image = decodeTGA(new Uint8Array(await file.arrayBuffer()));
  const scale = Math.min(1, MAX_TEXTURE_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const source = createCanvas(image.width, image.height);
  source.context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );

  const target = scale < 1 ? createCanvas(width, height) : source;
  if (target !== source) {
    target.context.imageSmoothingEnabled = true;
    target.context.imageSmoothingQuality = 'high';
    target.context.drawImage(source.canvas, 0, 0, width, height);
  }

  const canvas = target.canvas;
  let blob: Blob;
  if ('convertToBlob' in canvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG 编码失败'))),
        'image/png',
      );
    });
  }

  const png = new File([blob], file.name, { type: 'image/png', lastModified: file.lastModified });
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (relative) Object.defineProperty(png, 'webkitRelativePath', { value: relative });
  return png;
}

function createCanvas(width: number, height: number) {
  const canvas = typeof OffscreenCanvas === 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) throw new Error('浏览器不支持 2D 画布');
  return { canvas, context };
}
