import {
  bakeBaseColorPixels,
  resolveAlpha,
  srgbToLinear,
  type AlphaMode,
} from '../../src/texture-pixels.ts';
import type { AtlasBuild, AtlasRect, TextureSource, Vec3 } from './types.ts';

export interface AtlasInput {
  key: string;
  texture: TextureSource | null;
  uvBounds: [number, number, number, number] | null;
  /** sRGB tint, 0..1. */
  color: Vec3;
  opacity: number;
  /** glTF alpha semantics; defaults to BLEND when omitted. */
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
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
    const alphaMode = input.alphaMode ?? 'BLEND';
    const alphaCutoff = input.alphaCutoff ?? 0.5;
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
      context.fillStyle = rgba(input.color, resolveAlpha(input.opacity, alphaMode, alphaCutoff));
      context.fillRect(innerX, innerY, innerWidth, innerHeight);
      continue;
    }
    // Bake the base-color factor and alpha mode exactly like the Node atlas.
    const image = context.getImageData(innerX, innerY, innerWidth, innerHeight);
    bakeBaseColorPixels(image.data, {
      factor: [
        srgbToLinear(input.color[0]),
        srgbToLinear(input.color[1]),
        srgbToLinear(input.color[2]),
        input.opacity,
      ],
      alphaMode,
      alphaCutoff,
    });
    context.putImageData(image, innerX, innerY);
  }

  return { canvas, size, rects, coverage: coverageOf(context, size) };
}

export interface AtlasMaterialUsage {
  name: string;
  pixels: number;
}

export interface AtlasUsage {
  /** Share of atlas pixels covered by at least one non-transparent triangle. */
  sampledUtilization: number;
  /** Pixel count per material name; shared pixels count for every material. */
  materials: AtlasMaterialUsage[];
}

/**
 * Rasterize the final atlas UVs to measure how many pixels each material
 * actually covers. Mirrors the desktop workbench's texture report.
 */
export function measureAtlasUsage(
  canvas: HTMLCanvasElement,
  batches: readonly { name: string; positions: Float32Array; uvs: Float32Array | null }[],
  size: number,
): AtlasUsage {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { sampledUtilization: 0, materials: [] };
  const alpha = context.getImageData(0, 0, size, size).data;
  const used = new Uint8Array(size * size);
  const masks = new Map<string, Uint8Array>();
  const maskFor = (name: string) => {
    let mask = masks.get(name);
    if (!mask) {
      mask = new Uint8Array(size * size);
      masks.set(name, mask);
    }
    return mask;
  };

  for (const batch of batches) {
    const mask = maskFor(batch.name);
    const uvs = batch.uvs;
    if (!uvs) continue;
    const triangles = Math.min(batch.positions.length / 9, uvs.length / 6);
    for (let t = 0; t < triangles; t++) {
      const a = t * 3;
      const ax = uvs[a * 2]! * size;
      const ay = uvs[a * 2 + 1]! * size;
      const bx = uvs[(a + 1) * 2]! * size;
      const by = uvs[(a + 1) * 2 + 1]! * size;
      const cx = uvs[(a + 2) * 2]! * size;
      const cy = uvs[(a + 2) * 2 + 1]! * size;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-8) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const e0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          const e1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
          const e2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
          if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))) continue;
          const index = y * size + x;
          if (alpha[index * 4 + 3]! === 0) continue;
          mask[index] = 1;
          used[index] = 1;
        }
      }
    }
  }

  let covered = 0;
  for (const value of used) covered += value;
  return {
    sampledUtilization: covered / (size * size),
    materials: [...masks].map(([name, mask]) => ({
      name,
      pixels: mask.reduce((sum, value) => sum + value, 0),
    })),
  };
}

const rgba = (color: Vec3, alpha: number) =>
  `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${clamp(alpha, 0, 1)})`;

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
