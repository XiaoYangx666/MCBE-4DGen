import { expect, test } from 'vitest';
import { removeSolidBackground, type CutoutImage } from '../src/image-cutout.ts';

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): CutoutImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { data, width, height };
}

function alphaAt(image: CutoutImage, x: number, y: number) {
  return image.data[(y * image.width + x) * 4 + 3]!;
}

test('removes a solid background connected to the image edge', () => {
  const image = makeImage(10, 10, (x, y) =>
    x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [220, 30, 20, 255] : [255, 255, 255, 255],
  );
  const result = removeSolidBackground(image, { tolerance: 30 });

  expect(result.detected).toBe(true);
  expect(result.background).toEqual([255, 255, 255]);
  expect(result.removed).toBe(84);
  expect(result.removedRatio).toBeCloseTo(0.84);
  expect(alphaAt(image, 0, 0)).toBe(0);
  expect(alphaAt(image, 5, 5)).toBe(255);
});

test('keeps an enclosed background-coloured hole opaque', () => {
  const image = makeImage(10, 10, (x, y) => {
    const ring = (x === 2 || x === 7 || y === 2 || y === 7) && x >= 2 && x <= 7 && y >= 2 && y <= 7;
    return ring ? [220, 30, 20, 255] : [255, 255, 255, 255];
  });
  const result = removeSolidBackground(image, { tolerance: 30 });

  expect(result.detected).toBe(true);
  expect(result.removed).toBe(64);
  expect(alphaAt(image, 0, 0)).toBe(0);
  expect(alphaAt(image, 2, 2)).toBe(255);
  expect(alphaAt(image, 5, 5)).toBe(255);
});

test('leaves an already cut-out transparent PNG untouched', () => {
  const image = makeImage(10, 10, (x, y) =>
    x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [220, 30, 20, 255] : [0, 0, 0, 0],
  );
  const result = removeSolidBackground(image, { tolerance: 30 });

  expect(result.detected).toBe(false);
  expect(result.removed).toBe(0);
  expect(alphaAt(image, 5, 5)).toBe(255);
});

test('tolerance controls how much near-background colour is removed', () => {
  const make = () =>
    makeImage(12, 12, (x, y) => {
      const outer = x < 2 || x >= 10 || y < 2 || y >= 10;
      const ring = !outer && (x < 4 || x >= 8 || y < 4 || y >= 8);
      if (outer) return [245, 245, 245, 255];
      if (ring) return [230, 230, 230, 255];
      return [220, 30, 20, 255];
    });

  const tight = make();
  removeSolidBackground(tight, { tolerance: 0 });
  expect(alphaAt(tight, 0, 0)).toBe(0);
  expect(alphaAt(tight, 2, 2)).toBe(255);

  const loose = make();
  removeSolidBackground(loose, { tolerance: 30 });
  expect(alphaAt(loose, 0, 0)).toBe(0);
  expect(alphaAt(loose, 2, 2)).toBe(0);
});

test('preserves the alpha of a semi-transparent foreground pixel', () => {
  const image = makeImage(10, 10, (x, y) =>
    x === 5 && y === 5 ? [220, 30, 20, 128] : [255, 255, 255, 255],
  );
  removeSolidBackground(image, { tolerance: 30 });
  expect(alphaAt(image, 5, 5)).toBe(128);
});

test('rejects malformed image data', () => {
  expect(() =>
    removeSolidBackground({ data: new Uint8ClampedArray(3), width: 2, height: 2 }, { tolerance: 30 }),
  ).toThrow();
});
