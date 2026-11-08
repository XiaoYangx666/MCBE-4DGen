/**
 * Rectangle packer shared by the research candidates.
 *
 * This is the production browser algorithm (MaxRects-style, four sort orders,
 * no rotation) lifted into a pure function so the candidate planners and the
 * baseline port cannot drift apart.
 */
export interface PackBox {
  key: string;
  width: number;
  height: number;
  /**
   * Optional aspect variants (content size, same area within a small bound).
   * The packer picks whichever fits best, like the production desktop baker.
   */
  variants?: { width: number; height: number }[];
  /** False for flat/1×1 charts; filling leftover space with them is pointless. */
  growable?: boolean;
}

export interface PackRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PackOrder = 'area' | 'max' | 'height' | 'width';

export interface PackResult {
  rects: Map<string, PackRect>;
  chosen: Map<string, { width: number; height: number }>;
  score: number;
  /** Non-overlapping free rectangles left after the last placement. */
  free: PackRect[];
}

const boxArea = (box: PackBox) => box.width * box.height;

const boxOrder = (order: PackOrder, box: PackBox) => {
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

export const DEFAULT_ORDERS: readonly PackOrder[] = ['area', 'max', 'height', 'width'];

const contains = (outer: PackRect, inner: PackRect) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height &&
  outer.width > 0 &&
  outer.height > 0;

const identical = (a: PackRect, b: PackRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Drop free rectangles fully covered by another one. */
function pruneFree(rects: readonly PackRect[]): PackRect[] {
  return rects.filter(
    (rect, index) =>
      rect.width > 0 &&
      rect.height > 0 &&
      !rects.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          contains(other, rect) &&
          (!identical(other, rect) || otherIndex < index),
      ),
  );
}

/** Carve `used` out of every free rectangle it overlaps. */
function subtractFree(free: readonly PackRect[], used: PackRect): PackRect[] {
  const next: PackRect[] = [];
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
  return pruneFree(next);
}

/** Best short-side fit, then best long-side fit, then top-left. */
function pickFree(
  free: readonly PackRect[],
  width: number,
  height: number,
): PackRect | null {
  let best: PackRect | null = null;
  let bestShort = Infinity;
  let bestLong = Infinity;
  for (const rect of free) {
    if (width > rect.width || height > rect.height) continue;
    const short = Math.min(rect.width - width, rect.height - height);
    const long = Math.max(rect.width - width, rect.height - height);
    const better =
      short < bestShort ||
      (short === bestShort &&
        (long < bestLong ||
          (long === bestLong &&
            (!best || rect.y < best.y || (rect.y === best.y && rect.x < best.x)))));
    if (!best || better) {
      best = rect;
      bestShort = short;
      bestLong = long;
    }
  }
  return best;
}

/** Pack boxes (content size; `pad` is added per side) into a `size` square. */
export function packBoxes(
  boxes: readonly PackBox[],
  size: number,
  pad: number,
  orders: readonly PackOrder[] = DEFAULT_ORDERS,
): PackResult | null {
  let best: PackResult | null = null;
  for (const order of orders) {
    let free: PackRect[] = [{ x: 0, y: 0, width: size, height: size }];
    const rects = new Map<string, PackRect>();
    const chosen = new Map<string, { width: number; height: number }>();
    let usedRight = 0;
    let usedBottom = 0;
    let failed = false;
    for (const box of [...boxes].sort(
      (a, b) =>
        boxOrder(order, b) - boxOrder(order, a) || a.key.localeCompare(b.key),
    )) {
      const options =
        box.variants && box.variants.length
          ? box.variants
          : [{ width: box.width, height: box.height }];
      const baseAspect = box.width / Math.max(1, box.height);
      const choices: {
        rect: PackRect;
        width: number;
        height: number;
        penalty: number;
      }[] = [];
      for (const rect of free)
        for (const option of options) {
          const width = option.width + pad * 2;
          const height = option.height + pad * 2;
          if (width > rect.width || height > rect.height) continue;
          choices.push({
            rect,
            width,
            height,
            penalty: Math.abs(
              Math.log(option.width / Math.max(1, option.height) / baseAspect),
            ),
          });
        }
      choices.sort(
        (a, b) =>
          Math.min(a.rect.width - a.width, a.rect.height - a.height) -
            Math.min(b.rect.width - b.width, b.rect.height - b.height) ||
          Math.max(a.rect.width - a.width, a.rect.height - a.height) -
            Math.max(b.rect.width - b.width, b.rect.height - b.height) ||
          a.penalty - b.penalty ||
          a.rect.y - b.rect.y ||
          a.rect.x - b.rect.x,
      );
      const fit = choices[0];
      if (!fit) {
        failed = true;
        break;
      }
      const used = { x: fit.rect.x, y: fit.rect.y, width: fit.width, height: fit.height };
      rects.set(box.key, used);
      chosen.set(box.key, { width: fit.width - pad * 2, height: fit.height - pad * 2 });
      usedRight = Math.max(usedRight, used.x + used.width);
      usedBottom = Math.max(usedBottom, used.y + used.height);
      free = subtractFree(free, used);
    }
    if (failed) continue;
    const score = Math.max(usedRight, usedBottom) * size + usedRight + usedBottom;
    if (!best || score < best.score) best = { rects, chosen, score, free };
  }
  return best;
}

export interface GrowResult {
  rects: Map<string, PackRect>;
  chosen: Map<string, { width: number; height: number }>;
  free: PackRect[];
  /** Number of charts that moved or grew. */
  grown: number;
}

/** Growth steps, largest first; the first placement that fits wins. */
const GROW_STEPS = [2, 1.75, 1.5, 1.4, 1.3, 1.2, 1.1];

/**
 * Spend the atlas pixels the packer could not use.
 *
 * Uniform scaling stops at the first shape that cannot grow any further, which
 * leaves large empty corners even though the atlas has room (a pair of nearly
 * square charts simply cannot both get bigger). This pass takes each packed
 * chart, removes it from the layout and tries to place a larger copy of it
 * into the remaining free space. Growing keeps the chart's aspect ratio, so
 * texels stay square; nothing is stretched, and the extra pixels become real
 * resolution for that chart instead of transparent atlas.
 *
 * Several passes let the rectangle freed by one chart feed the next.
 */
export function growPackedBoxes(
  boxes: readonly PackBox[],
  size: number,
  pad: number,
  packed: PackResult,
  maxScale = 2,
): GrowResult {
  const rects = new Map(packed.rects);
  const chosen = new Map(packed.chosen);
  let free = [...packed.free];
  const growable = boxes
    .filter((box) => box.growable !== false && rects.has(box.key) && chosen.has(box.key))
    .sort(
      (a, b) =>
        chosen.get(b.key)!.width * chosen.get(b.key)!.height -
          chosen.get(a.key)!.width * chosen.get(a.key)!.height ||
        a.key.localeCompare(b.key),
    );
  if (growable.length < 2 || !free.length) return { rects, chosen, free, grown: 0 };
  const original = new Map(
    [...chosen].map(([key, size]) => [key, { ...size }] as const),
  );
  let grown = 0;
  for (let pass = 0; pass < 3; pass++) {
    let moved = 0;
    for (const box of growable) {
      const outer = rects.get(box.key)!;
      const current = chosen.get(box.key)!;
      const source = original.get(box.key)!;
      const baseArea = current.width * current.height;
      if (baseArea <= 0) continue;
      const pool = pruneFree([...free, outer]);
      let placed: { rect: PackRect; width: number; height: number } | null = null;
      for (const step of GROW_STEPS) {
        if (step > maxScale) continue;
        const width = Math.max(
          current.width + 1,
          Math.min(Math.round(source.width * maxScale), Math.round(current.width * step)),
        );
        const height = Math.max(
          current.height + 1,
          Math.min(Math.round(source.height * maxScale), Math.round(current.height * step)),
        );
        if (width * height <= baseArea) continue;
        const outerWidth = width + pad * 2;
        const outerHeight = height + pad * 2;
        if (outerWidth > size || outerHeight > size) continue;
        const fit = pickFree(pool, outerWidth, outerHeight);
        if (!fit) continue;
        placed = {
          rect: { x: fit.x, y: fit.y, width: outerWidth, height: outerHeight },
          width,
          height,
        };
        break;
      }
      if (!placed) continue;
      rects.set(box.key, placed.rect);
      chosen.set(box.key, { width: placed.width, height: placed.height });
      free = subtractFree(pool, placed.rect);
      moved++;
    }
    grown += moved;
    if (!moved) break;
  }
  return { rects, chosen, free, grown };
}
