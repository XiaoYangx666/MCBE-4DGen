import {
  bakeBaseColorPixels,
  resolveAlpha,
  srgbToLinear,
  type AlphaMode,
} from '../../src/texture-pixels.ts';
import { yieldToBrowser } from './progress.ts';
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

/** Sublinear demand keeps one dominant material from crowding out small details. */
const ALLOCATION_POWER = 0.85;

interface AtlasBox {
  key: string;
  width: number;
  height: number;
}

const boxArea = (box: AtlasBox) => box.width * box.height;
const boxOrder = (order: string, box: AtlasBox) => {
  switch (order) {
    case 'height':
      return box.height;
    case 'width':
      return box.width;
    case 'max':
      return Math.max(box.width, box.height);
    default:
      return boxArea(box);
  }
};

/** Rectangle-only MaxRects-style packer. Boxes already include their own pad. */
function packBoxes(
  boxes: readonly AtlasBox[],
  size: number,
  orders: readonly string[],
): { rects: Map<string, AtlasRect>; score: number } | null {
  let best: { rects: Map<string, AtlasRect>; score: number } | null = null;
  for (const order of orders) {
    let free: AtlasRect[] = [{ x: 0, y: 0, width: size, height: size, pad: 0 }];
    const rects = new Map<string, AtlasRect>();
    let usedRight = 0,
      usedBottom = 0;
    let failed = false;
    for (const box of [...boxes].sort(
      (a, b) => boxOrder(order, b) - boxOrder(order, a) || a.key.localeCompare(b.key),
    )) {
      const choices = free
        .filter((rect) => box.width <= rect.width && box.height <= rect.height)
        .sort(
          (a, b) =>
            Math.min(a.width - box.width, a.height - box.height) -
              Math.min(b.width - box.width, b.height - box.height) ||
            Math.max(a.width - box.width, a.height - box.height) -
              Math.max(b.width - box.width, b.height - box.height) ||
            a.y - b.y ||
            a.x - b.x,
        );
      const fit = choices[0];
      if (!fit) {
        failed = true;
        break;
      }
      const used = { x: fit.x, y: fit.y, width: box.width, height: box.height };
      rects.set(box.key, { ...used, pad: 0 });
      usedRight = Math.max(usedRight, used.x + used.width);
      usedBottom = Math.max(usedBottom, used.y + used.height);
      const next: AtlasRect[] = [];
      for (const rect of free) {
        if (
          used.x >= rect.x + rect.width ||
          used.x + used.width <= rect.x ||
          used.y >= rect.y + rect.height ||
          used.y + used.height <= rect.y
        ) {
          next.push(rect);
          continue;
        }
        if (used.x > rect.x) next.push({ ...rect, width: used.x - rect.x });
        if (used.x + used.width < rect.x + rect.width)
          next.push({
            ...rect,
            x: used.x + used.width,
            width: rect.x + rect.width - used.x - used.width,
          });
        if (used.y > rect.y) next.push({ ...rect, height: used.y - rect.y });
        if (used.y + used.height < rect.y + rect.height)
          next.push({
            ...rect,
            y: used.y + used.height,
            height: rect.y + rect.height - used.y - used.height,
          });
      }
      free = next.filter(
        (rect, index) =>
          !next.some(
            (other, otherIndex) =>
              index !== otherIndex &&
              other.x <= rect.x &&
              other.y <= rect.y &&
              other.x + other.width >= rect.x + rect.width &&
              other.y + other.height >= rect.y + rect.height &&
              (other.x !== rect.x ||
                other.y !== rect.y ||
                other.width !== rect.width ||
                other.height !== rect.height ||
                otherIndex < index),
          ),
      );
    }
    if (failed) continue;
    const score = Math.max(usedRight, usedBottom) * size + usedRight + usedBottom;
    if (!best || score < best.score) best = { rects, score };
  }
  return best;
}

/**
 * Plan the 128 px atlas. Rectangles are budgeted by world-space surface area
 * (sublinear, so one dominant material cannot starve small parts), then packed
 * with a deterministic MaxRects search. Flat/untextured materials only need a
 * single sampleable texel. The result is unit-testable without a canvas.
 */
export function planAtlas(inputs: readonly AtlasInput[], size = 128, pad = 1): AtlasLayout {
  const unique = new Map<string, AtlasInput>();
  for (const input of inputs) if (!unique.has(input.key)) unique.set(input.key, input);
  const values = [...unique.values()];
  if (!values.length) return { size, rects: new Map(), scale: 1 };
  const innerSize = Math.max(1, size - pad * 2);
  const minFlat = pad * 2 + 1;
  const minTextured = pad * 2 + 3;
  const hasTexture = (input: AtlasInput) => !!(input.texture && input.uvBounds);

  if (values.length === 1) {
    const input = values[0]!;
    const minOuter = hasTexture(input) ? minTextured : minFlat;
    const aspect = aspectOf(input);
    let width = hasTexture(input) ? innerSize : minOuter;
    let height = hasTexture(input) ? Math.max(minOuter, Math.round(width / aspect)) : minOuter;
    if (height > innerSize) {
      height = innerSize;
      width = Math.max(minOuter, Math.round(height * aspect));
    }
    width = clamp(width, minOuter, innerSize);
    height = clamp(height, minOuter, innerSize);
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

  const demand = values.map((input) =>
    hasTexture(input) ? Math.pow(Math.max(0, input.area), ALLOCATION_POWER) : 0,
  );
  const totalDemand = demand.reduce((sum, value) => sum + value, 0);
  const usable = innerSize * innerSize * 0.92;
  const boxesAt = (scale: number): AtlasBox[] =>
    values.map((input, index) => {
      const textured = hasTexture(input);
      const minOuter = textured ? minTextured : minFlat;
      const share = totalDemand > 0 ? demand[index]! / totalDemand : 0;
      const target = Math.max(minOuter * minOuter, usable * share * scale);
      const aspect = aspectOf(input);
      const width = clamp(Math.sqrt(target * aspect), minOuter, innerSize);
      const height = clamp(Math.sqrt(target / aspect), minOuter, innerSize);
      return { key: input.key, width: Math.ceil(width), height: Math.ceil(height) };
    });

  const orders = ['area', 'max', 'height', 'width'] as const;
  const attempt = (scale: number) => {
    const packed = packBoxes(boxesAt(scale), size, orders);
    if (!packed) return null;
    const rects = new Map<string, AtlasRect>();
    for (const [key, rect] of packed.rects)
      rects.set(key, { ...rect, pad });
    return { size, rects, scale };
  };

  const full = attempt(1);
  if (full) return full;
  let low = 0.18,
    high = 1,
    best: AtlasLayout | null = null;
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2;
    const layout = attempt(mid);
    if (layout) {
      best = layout;
      low = mid;
    } else high = mid;
  }
  if (best) return best;

  // Many tiny materials: fall back to an even grid.
  let columns = Math.min(
    Math.ceil(Math.sqrt(values.length)),
    Math.max(1, Math.floor(size / minFlat)),
  );
  let cell = Math.floor(size / columns);
  let rows = Math.ceil(values.length / columns);
  if (rows * cell > size) {
    // Extremely material-heavy models need a 2 px cell (1 px content). This is
    // still safe from overlap, though linear filtering gets tighter margins.
    columns = Math.min(
      Math.ceil(Math.sqrt(values.length)),
      Math.max(1, Math.floor(size / 2)),
    );
    cell = 2;
    rows = Math.ceil(values.length / columns);
    if (rows * cell > size)
      throw new Error('材质数量超过 128×128 图集可安全容纳的数量');
  }
  const rects = new Map<string, AtlasRect>();
  values.forEach((input, index) => {
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    rects.set(input.key, {
      x,
      y,
      width: Math.max(cell, 2),
      height: Math.max(cell, 2),
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
      context.clearRect(innerX - rect.pad, innerY - rect.pad, innerWidth + rect.pad * 2, innerHeight + rect.pad * 2);
      context.fillStyle = rgba(input.color, resolveAlpha(input.opacity, alphaMode, alphaCutoff));
      context.fillRect(innerX - rect.pad, innerY - rect.pad, innerWidth + rect.pad * 2, innerHeight + rect.pad * 2);
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
    // Extend the chart edge into its pad. This keeps linear filtering from
    // sampling a neighboring chart or transparent atlas space at UV edges.
    const paddedWidth = innerWidth + rect.pad * 2;
    const paddedHeight = innerHeight + rect.pad * 2;
    const padded = context.createImageData(paddedWidth, paddedHeight);
    for (let y = 0; y < paddedHeight; y++) {
      const sy = clamp(y - rect.pad, 0, innerHeight - 1);
      for (let x = 0; x < paddedWidth; x++) {
        const sx = clamp(x - rect.pad, 0, innerWidth - 1);
        const source = (sy * innerWidth + sx) * 4;
        const target = (y * paddedWidth + x) * 4;
        for (let channel = 0; channel < 4; channel++)
          padded.data[target + channel] = image.data[source + channel]!;
      }
    }
    context.putImageData(padded, innerX - rect.pad, innerY - rect.pad);
  }

  return { canvas, size, rects, coverage: coverageOf(context, size) };
}

export interface AtlasMaterialUsage {
  name: string;
  /** Non-transparent pixels covered by this material's triangles. */
  pixels: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvPixels?: number;
}

export interface AtlasUsage {
  /** Share of atlas pixels covered by at least one non-transparent triangle. */
  sampledUtilization: number;
  /** Share of atlas pixels covered by a triangle, including transparent texels. */
  uvUtilization: number;
  sampledPixels: number;
  uvPixels: number;
  /** Pixel count per material name; shared pixels count for every material. */
  materials: AtlasMaterialUsage[];
}

export interface AtlasUsageOptions {
  /** Called before each material is rasterized, so the UI can show `3/12`. */
  onProgress?: (done: number, total: number, name: string) => void;
}

/**
 * Rasterize the final atlas UVs to measure how many pixels each material
 * actually covers. Mirrors the desktop workbench's texture report.
 */
export async function measureAtlasUsage(
  canvas: HTMLCanvasElement,
  batches: readonly { name: string; positions: Float32Array; uvs: Float32Array | null }[],
  size: number,
  options: AtlasUsageOptions = {},
): Promise<AtlasUsage> {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { sampledUtilization: 0, uvUtilization: 0, sampledPixels: 0, uvPixels: 0, materials: [] };
  const alpha = context.getImageData(0, 0, size, size).data;
  const used = new Uint8Array(size * size);
  const uvUsed = new Uint8Array(size * size);
  const masks = new Map<string, Uint8Array>();
  const uvMasks = new Map<string, Uint8Array>();
  const maskFor = (name: string, uv: boolean) => {
    const map = uv ? uvMasks : masks;
    let mask = map.get(name);
    if (!mask) {
      mask = new Uint8Array(size * size);
      map.set(name, mask);
    }
    return mask;
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;
    options.onProgress?.(batchIndex, batches.length, batch.name);
    await yieldToBrowser();
    const mask = maskFor(batch.name, false);
    const uvMask = maskFor(batch.name, true);
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
      if (Math.abs(area) < 1e-8) {
        const x = Math.max(0, Math.min(size - 1, Math.floor((ax + bx + cx) / 3)));
        const y = Math.max(0, Math.min(size - 1, Math.floor((ay + by + cy) / 3)));
        const index = y * size + x;
        uvMask[index] = 1;
        uvUsed[index] = 1;
        if (alpha[index * 4 + 3]! !== 0) {
          mask[index] = 1;
          used[index] = 1;
        }
        continue;
      }
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      // Edge functions are linear, so step them along each scanline instead of
      // recomputing three cross products per pixel.
      const e0dx = ay - by;
      const e1dx = by - cy;
      const e2dx = cy - ay;
      const startX = x0 + 0.5;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        let e0 = (bx - ax) * (py - ay) - (by - ay) * (startX - ax);
        let e1 = (cx - bx) * (py - by) - (cy - by) * (startX - bx);
        let e2 = (ax - cx) * (py - cy) - (ay - cy) * (startX - cx);
        for (let x = x0; x <= x1; x++, e0 += e0dx, e1 += e1dx, e2 += e2dx) {
          if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))) continue;
          const index = y * size + x;
          uvMask[index] = 1;
          uvUsed[index] = 1;
          if (alpha[index * 4 + 3]! === 0) continue;
          mask[index] = 1;
          used[index] = 1;
        }
      }
    }
  }

  let covered = 0;
  for (const value of used) covered += value;
  let uvCovered = 0;
  for (const value of uvUsed) uvCovered += value;
  return {
    sampledUtilization: covered / (size * size),
    uvUtilization: uvCovered / (size * size),
    sampledPixels: covered,
    uvPixels: uvCovered,
    materials: [...masks].map(([name, mask]) => ({
      name,
      pixels: mask.reduce((sum, value) => sum + value, 0),
      uvPixels: uvMasks.get(name)!.reduce((sum, value) => sum + value, 0),
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
