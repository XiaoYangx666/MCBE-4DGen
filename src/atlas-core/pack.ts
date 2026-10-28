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
}

export interface PackRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PackOrder = 'area' | 'max' | 'height' | 'width';

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

/** Pack boxes (content size; `pad` is added per side) into a `size` square. */
export function packBoxes(
  boxes: readonly PackBox[],
  size: number,
  pad: number,
  orders: readonly PackOrder[] = DEFAULT_ORDERS,
): {
  rects: Map<string, PackRect>;
  chosen: Map<string, { width: number; height: number }>;
  score: number;
} | null {
  let best: {
    rects: Map<string, PackRect>;
    chosen: Map<string, { width: number; height: number }>;
    score: number;
  } | null = null;
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
    if (!best || score < best.score) best = { rects, chosen, score };
  }
  return best;
}
