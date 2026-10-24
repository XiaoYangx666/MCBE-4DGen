import type { AtlasBuild, AtlasRect, TextureSource, Vec3 } from './types.ts';

export interface AtlasInput {
  key: string;
  texture: TextureSource | null;
  uvBounds: [number, number, number, number] | null;
  /** sRGB tint, 0..1. */
  color: Vec3;
  opacity: number;
  /** Used to apportion atlas space. */
  area: number;
}

export interface AtlasLayout {
  size: number;
  rects: Map<string, AtlasRect>;
  /** Applied scale after shrinking to fit, 1 when everything fit immediately. */
  scale: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Shelf-pack one rectangle per unique atlas key. Sizes are budgeted by surface
 * area and source aspect ratio, then uniformly shrunk until the 128 px atlas
 * fits. Deterministic, so it can be unit tested without a canvas.
 */
export function planAtlas(inputs: readonly AtlasInput[], size = 128, pad = 1): AtlasLayout {
  const unique = new Map<string, AtlasInput>();
  for (const input of inputs) if (!unique.has(input.key)) unique.set(input.key, input);
  const values = [...unique.values()];
  if (!values.length) return { size, rects: new Map(), scale: 1 };
  const innerSize = size - pad * 2;

  if (values.length === 1) {
    const input = values[0]!;
    const aspect = aspectOf(input);
    let width = innerSize;
    let height = Math.round(width / aspect);
    if (height > innerSize) {
      height = innerSize;
      width = Math.round(height * aspect);
    }
    width = clamp(width, 6, innerSize);
    height = clamp(height, 6, innerSize);
    return {
      size,
      rects: new Map([[input.key, {
        x: Math.floor((size - width) / 2),
        y: Math.floor((size - height) / 2),
        width,
        height,
        pad,
      }]]),
      scale: 1,
    };
  }

  const totalArea = values.reduce((sum, input) => sum + Math.max(0, input.area), 0);
  const usable = innerSize * innerSize * 0.92;
  for (let scale = 1; scale >= 0.18; scale *= 0.9) {
    const boxes = values.map((input) => {
      const share = totalArea > 0 ? Math.max(0, input.area) / totalArea : 1 / values.length;
      const target = Math.max(36, usable * share * scale);
      const aspect = aspectOf(input);
      let width = Math.sqrt(target * aspect);
      let height = width / aspect;
      width = clamp(width, 6, innerSize);
      height = clamp(height, 6, innerSize);
      return { key: input.key, width: Math.ceil(width), height: Math.ceil(height) };
    }).sort((a, b) => b.height - a.height || a.key.localeCompare(b.key));

    const rects = new Map<string, AtlasRect>();
    let x = pad, y = pad, rowHeight = 0;
    let failed = false;
    for (const box of boxes) {
      if (x + box.width + pad > size) {
        x = pad;
        y += rowHeight + pad;
        rowHeight = 0;
      }
      if (y + box.height + pad > size) {
        failed = true;
        break;
      }
      rects.set(box.key, { x, y, width: box.width, height: box.height, pad });
      x += box.width + pad;
      rowHeight = Math.max(rowHeight, box.height);
    }
    if (!failed) return { size, rects, scale };
  }

  // Many tiny materials: fall back to an even grid.
  const columns = Math.ceil(Math.sqrt(values.length));
  const cell = Math.floor(size / columns);
  const rects = new Map<string, AtlasRect>();
  values.forEach((input, index) => {
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    rects.set(input.key, {
      x: x + pad,
      y: y + pad,
      width: Math.max(2, cell - pad * 2),
      height: Math.max(2, cell - pad * 2),
      pad,
    });
  });
  return { size, rects, scale: 0.18 };
}

function aspectOf(input: AtlasInput) {
  if (!input.texture || !input.uvBounds) return 1;
  const [u0, v0, u1, v1] = input.uvBounds;
  const width = Math.max(0.001, (u1 - u0) * input.texture.width);
  const height = Math.max(0.001, (v1 - v0) * input.texture.height);
  return clamp(width / height, 0.2, 5);
}

/** Painter for the planned atlas. Tints and opacity are baked into pixels. */
export function renderAtlas(inputs: readonly AtlasInput[], layout: AtlasLayout): AtlasBuild {
  const { size, rects } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建 2D 画布');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const unique = new Map<string, AtlasInput>();
  for (const input of inputs) if (!unique.has(input.key)) unique.set(input.key, input);

  for (const [key, input] of unique) {
    const rect = rects.get(key);
    if (!rect) continue;
    const innerX = rect.x + rect.pad;
    const innerY = rect.y + rect.pad;
    const innerWidth = Math.max(1, rect.width - rect.pad * 2);
    const innerHeight = Math.max(1, rect.height - rect.pad * 2);
    const texture = input.texture;
    const bounds = input.uvBounds;
    let drawn = false;
    if (texture && bounds) {
      const sx = clamp(bounds[0] * texture.width, 0, texture.width);
      const sy = clamp(bounds[1] * texture.height, 0, texture.height);
      const sw = clamp((bounds[2] - bounds[0]) * texture.width, 0, texture.width - sx);
      const sh = clamp((bounds[3] - bounds[1]) * texture.height, 0, texture.height - sy);
      if (sw >= 0.5 && sh >= 0.5) {
        context.clearRect(innerX, innerY, innerWidth, innerHeight);
        context.drawImage(texture.image, sx, sy, sw, sh, innerX, innerY, innerWidth, innerHeight);
        drawn = true;
      }
    }
    if (!drawn) {
      context.clearRect(innerX, innerY, innerWidth, innerHeight);
      context.fillStyle = rgba(input.color, input.opacity);
      context.fillRect(innerX, innerY, innerWidth, innerHeight);
    } else if (needsPixelPass(input)) {
      tintRect(context, innerX, innerY, innerWidth, innerHeight, input);
    }
  }

  return { canvas, size, rects, coverage: coverageOf(context, size) };
}

const rgba = (color: Vec3, alpha: number) =>
  `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${clamp(alpha, 0, 1)})`;

function needsPixelPass(input: AtlasInput) {
  return input.opacity < 0.999 ||
    input.color[0] < 0.999 || input.color[1] < 0.999 || input.color[2] < 0.999;
}

function tintRect(
  context: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number,
  input: AtlasInput,
) {
  const image = context.getImageData(x, y, width, height);
  const data = image.data;
  const [red, green, blue] = input.color;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i]! * red;
    data[i + 1] = data[i + 1]! * green;
    data[i + 2] = data[i + 2]! * blue;
    data[i + 3] = data[i + 3]! * input.opacity;
  }
  context.putImageData(image, x, y);
}

function coverageOf(context: CanvasRenderingContext2D, size: number) {
  const data = context.getImageData(0, 0, size, size).data;
  let used = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) used++;
  return used / (size * size);
}

/** Rewrite image-space UVs into atlas space. Mutates the supplied array. */
export function remapUvs(
  uvs: Float32Array,
  bounds: [number, number, number, number] | null,
  rect: AtlasRect,
  size: number,
) {
  const innerX = rect.x + rect.pad;
  const innerY = rect.y + rect.pad;
  const innerWidth = Math.max(1, rect.width - rect.pad * 2);
  const innerHeight = Math.max(1, rect.height - rect.pad * 2);
  const centerU = (innerX + innerWidth / 2) / size;
  const centerV = (innerY + innerHeight / 2) / size;
  if (!bounds || bounds[2] - bounds[0] < 1e-6 || bounds[3] - bounds[1] < 1e-6) {
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i] = centerU;
      uvs[i + 1] = centerV;
    }
    return;
  }
  const [u0, v0, u1, v1] = bounds;
  for (let i = 0; i < uvs.length; i += 2) {
    const u = clamp((uvs[i]! - u0) / (u1 - u0), 0, 1);
    const v = clamp((uvs[i + 1]! - v0) / (v1 - v0), 0, 1);
    uvs[i] = (innerX + u * innerWidth) / size;
    uvs[i + 1] = (innerY + v * innerHeight) / size;
  }
}
