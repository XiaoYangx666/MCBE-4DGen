/**
 * Solid-colour background removal shared by the desktop sharp pipeline and the
 * browser canvas pipeline. Operates on straight-alpha RGBA bytes in row-major
 * order and never touches pixels that are not connected to the image border.
 */

export interface CutoutImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface CutoutOptions {
  /** 0–100. Larger values remove colours closer to the detected background. */
  tolerance: number;
  /** 0–100. Softens the one-pixel cut edge. Defaults to a value derived from tolerance. */
  feather?: number;
}

export interface CutoutResult {
  /** Opaque pixels that became fully transparent. */
  removed: number;
  /** `removed / (width * height)`. */
  removedRatio: number;
  /** Whether a solid background was found and at least one pixel removed. */
  detected: boolean;
  /** Detected background colour as RGB. */
  background: [number, number, number];
}

const ALPHA_THRESHOLD = 8;
const BORDER_OPAQUE_MIN = 0.2;
/** Even tolerance 0 removes the tiny colour differences introduced by JPEG noise. */
const MIN_TOLERANCE = 10;

/**
 * Remove a solid background connected to the image edge.
 *
 * The image is treated as already cut out when its border is mostly
 * transparent, so running this on an existing transparent PNG is a no-op.
 * Enclosed regions of the background colour stay opaque on purpose.
 */
export function removeSolidBackground(image: CutoutImage, options: CutoutOptions): CutoutResult {
  const { data, width, height } = image;
  const total = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length < total * 4
  )
    throw new Error('Invalid image data');

  const tolerance = Math.max(MIN_TOLERANCE, (clamp(options.tolerance, 0, 100) / 100) * 255);
  const tolerance2 = tolerance * tolerance;
  const feather =
    options.feather === undefined
      ? Math.max(12, tolerance * 0.4)
      : (clamp(options.feather, 0, 100) / 100) * 255;

  if (opaqueBorderRatio(data, width, height) < BORDER_OPAQUE_MIN)
    return { removed: 0, removedRatio: 0, detected: false, background: [0, 0, 0] };

  const background = estimateBackground(data, width, height, tolerance);
  if (!background)
    return { removed: 0, removedRatio: 0, detected: false, background: [0, 0, 0] };
  const [br, bg, bb] = background;

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const matches = (index: number) => {
    const offset = index * 4;
    if (data[offset + 3]! <= ALPHA_THRESHOLD) return true;
    const dr = data[offset]! - br;
    const dg = data[offset + 1]! - bg;
    const db = data[offset + 2]! - bb;
    return dr * dr + dg * dg + db * db <= tolerance2;
  };

  const enqueue = (index: number) => {
    if (visited[index]) return;
    if (!matches(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  // Transparent border pixels are already background and let the fill reach a
  // solid background that sits inside a transparent margin.
  for (let x = 0; x < width; x++) {
    enqueue(x);
    if (height > 1) enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    if (width > 1) enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let removed = 0;
  for (let index = 0; index < total; index++) {
    if (visited[index] && data[index * 4 + 3]! > ALPHA_THRESHOLD) removed++;
  }
  if (removed === 0)
    return { removed: 0, removedRatio: 0, detected: false, background };

  // Soften only the one-pixel boundary next to removed pixels. Pixels far from
  // the background colour keep their original alpha.
  if (feather > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (visited[index]) continue;
        const alphaIndex = index * 4 + 3;
        const originalAlpha = data[alphaIndex]!;
        if (originalAlpha <= ALPHA_THRESHOLD) continue;
        if (!hasBackgroundNeighbor(visited, x, y, width, height)) continue;
        const offset = index * 4;
        const dr = data[offset]! - br;
        const dg = data[offset + 1]! - bg;
        const db = data[offset + 2]! - bb;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        const factor = clamp((distance - tolerance) / feather, 0, 1);
        if (factor < 1) data[alphaIndex] = Math.round(originalAlpha * factor);
      }
    }
  }

  for (let index = 0; index < total; index++) {
    if (visited[index]) data[index * 4 + 3] = 0;
  }

  return { removed, removedRatio: removed / total, detected: true, background };
}

function opaqueBorderRatio(data: CutoutImage['data'], width: number, height: number): number {
  let opaque = 0;
  let count = 0;
  const visit = (x: number, y: number) => {
    count++;
    if (data[(y * width + x) * 4 + 3]! > ALPHA_THRESHOLD) opaque++;
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  return count ? opaque / count : 0;
}

/**
 * Estimate the background from the border of the opaque bounding box. The box
 * excludes transparent margins, so a normal PNG with padding still works.
 */
function estimateBackground(
  data: CutoutImage['data'],
  width: number,
  height: number,
  tolerance: number,
): [number, number, number] | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const bins = new Uint32Array(16 * 16 * 16);
  const sums = new Float64Array(16 * 16 * 16 * 3);
  let samples = 0;
  const visit = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3]! <= ALPHA_THRESHOLD) return;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    bins[key] = bins[key]! + 1;
    sums[key * 3] = sums[key * 3]! + r;
    sums[key * 3 + 1] = sums[key * 3 + 1]! + g;
    sums[key * 3 + 2] = sums[key * 3 + 2]! + b;
    samples++;
  };
  for (let x = minX; x <= maxX; x++) {
    visit(x, minY);
    if (maxY !== minY) visit(x, maxY);
  }
  for (let y = minY + 1; y < maxY; y++) {
    visit(minX, y);
    if (maxX !== minX) visit(maxX, y);
  }
  if (!samples) return null;

  let bestKey = -1;
  let bestCount = 0;
  for (let key = 0; key < bins.length; key++) {
    const count = bins[key]!;
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (bestKey < 0 || bestCount === 0) return null;
  const background: [number, number, number] = [
    Math.round(sums[bestKey * 3]! / bestCount),
    Math.round(sums[bestKey * 3 + 1]! / bestCount),
    Math.round(sums[bestKey * 3 + 2]! / bestCount),
  ];

  // A useful background must cover a meaningful part of the opaque border.
  const tolerance2 = tolerance * tolerance;
  let matching = 0;
  const check = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3]! <= ALPHA_THRESHOLD) return;
    const dr = data[offset]! - background[0];
    const dg = data[offset + 1]! - background[1];
    const db = data[offset + 2]! - background[2];
    if (dr * dr + dg * dg + db * db <= tolerance2) matching++;
  };
  for (let x = minX; x <= maxX; x++) {
    check(x, minY);
    if (maxY !== minY) check(x, maxY);
  }
  for (let y = minY + 1; y < maxY; y++) {
    check(minX, y);
    if (maxX !== minX) check(maxX, y);
  }
  if (matching / samples < 0.05) return null;
  return background;
}

function hasBackgroundNeighbor(
  mask: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (x > 0 && mask[y * width + x - 1]) return true;
  if (x + 1 < width && mask[y * width + x + 1]) return true;
  if (y > 0 && mask[(y - 1) * width + x]) return true;
  if (y + 1 < height && mask[(y + 1) * width + x]) return true;
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
