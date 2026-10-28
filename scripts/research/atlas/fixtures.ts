/**
 * Deterministic synthetic fixtures covering the edge cases the research brief
 * lists: shared textures, overlapping UVs, sparse islands, part deletion,
 * duplicate material names, large/small mixes and degenerate geometry.
 *
 * Everything here is generated from a seeded PRNG, so results are exactly
 * reproducible on any machine without external assets.
 */
import type { ChartInput, RgbaImage } from './types.ts';

export interface Fixture {
  name: string;
  description: string;
  inputs: ChartInput[];
  /** Material ids that the weight experiments target. */
  focus: string[];
  /** Known ground truth used by assertions. */
  notes: string;
}

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Pattern = 'checker' | 'noise' | 'gradient' | 'face' | 'cloth' | 'hair' | 'solid';

export function makeImage(
  key: string,
  width: number,
  height: number,
  pattern: Pattern,
  seed = 1,
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  const random = mulberry32(seed);
  // Pre-generate noise so sampling the same fixture twice is identical.
  const noise = new Float32Array(width * height);
  for (let i = 0; i < noise.length; i++) noise[i] = random();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const u = x / width;
      const v = y / height;
      let red = 128;
      let green = 128;
      let blue = 128;
      let alpha = 255;
      switch (pattern) {
        case 'checker': {
          const size = Math.max(2, Math.round(width / 16));
          const on = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
          red = on ? 235 : 25;
          green = on ? 225 : 35;
          blue = on ? 210 : 45;
          break;
        }
        case 'noise': {
          const n = Math.round(noise[y * width + x]! * 255);
          red = n;
          green = 255 - n;
          blue = (n * 7 + x * 3 + y * 5) % 256;
          break;
        }
        case 'gradient':
          red = Math.round(u * 255);
          green = Math.round(v * 255);
          blue = Math.round(((u + v) / 2) * 255);
          break;
        case 'face': {
          red = 232;
          green = 196;
          blue = 176;
          // Eyes, brows and mouth: high-frequency detail the atlas must keep.
          const eyeY = height * 0.42;
          for (const eyeX of [width * 0.32, width * 0.68]) {
            const dx = x - eyeX;
            const dy = (y - eyeY) * 1.8;
            if ((dx * dx) / (width * 0.09) ** 2 + (dy * dy) / (height * 0.06) ** 2 < 1) {
              red = 250;
              green = 250;
              blue = 252;
              if (dx * dx + dy * dy < (width * 0.035) ** 2) {
                red = 36;
                green = 78;
                blue = 142;
              }
            }
          }
          if (y > height * 0.68 && y < height * 0.72 && Math.abs(x - width * 0.5) < width * 0.09) {
            red = 178;
            green = 72;
            blue = 84;
          }
          red = (red + Math.round(noise[y * width + x]! * 24) - 12) & 0xff;
          break;
        }
        case 'cloth': {
          const stripe = Math.floor(x / Math.max(2, width / 32)) % 2;
          red = stripe ? 62 : 96;
          green = stripe ? 88 : 46;
          blue = stripe ? 148 : 92;
          const weave = (x + y) % 6 === 0 ? 28 : 0;
          red = Math.min(255, red + weave);
          green = Math.min(255, green + weave);
          blue = Math.min(255, blue + weave);
          break;
        }
        case 'hair': {
          const strand = Math.floor((x / width) * 48);
          const shade = 40 + ((strand * 37) % 90);
          const highlight = Math.abs(Math.sin(((y / height) * 9 + strand) * 1.7)) > 0.94;
          red = highlight ? shade + 90 : shade;
          green = highlight ? shade + 60 : shade - 6;
          blue = highlight ? shade + 40 : shade - 14;
          break;
        }
        default:
          red = 200;
          green = 170;
          blue = 150;
      }
      data[i] = Math.min(255, Math.max(0, red));
      data[i + 1] = Math.min(255, Math.max(0, green));
      data[i + 2] = Math.min(255, Math.max(0, blue));
      data[i + 3] = alpha;
    }
  return { width, height, data, key };
}

type Vec3 = [number, number, number];
type Vec2 = [number, number];

/** Accumulates a triangle soup for one material batch. */
class Soup {
  readonly uvs: number[] = [];
  readonly areas: number[] = [];
  readonly positions: number[] = [];

  triangle(a: Vec3, b: Vec3, c: Vec3, ua: Vec2, ub: Vec2, uc: Vec2) {
    this.positions.push(...a, ...b, ...c);
    this.uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.areas.push(triangleArea(a, b, c));
  }

  /** Axis-aligned plane in XY, `segments` quads per axis. */
  plane(options: {
    width: number;
    height: number;
    origin?: Vec3;
    segments?: number;
    uv?: [number, number, number, number];
    flip?: boolean;
  }) {
    const {
      width,
      height,
      origin = [0, 0, 0],
      segments = 1,
      uv = [0, 0, 1, 1],
    } = options;
    const n = Math.max(1, Math.round(segments));
    const [u0, v0, u1, v1] = uv;
    const point = (i: number, j: number): [Vec3, Vec2] => [
      [
        origin[0] + (i / n) * width,
        origin[1] + (j / n) * height,
        origin[2],
      ],
      [u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * j) / n],
    ];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const [p00, t00] = point(i, j);
        const [p10, t10] = point(i + 1, j);
        const [p01, t01] = point(i, j + 1);
        const [p11, t11] = point(i + 1, j + 1);
        if (options.flip) {
          this.triangle(p00, p11, p10, t00, t11, t10);
          this.triangle(p00, p01, p11, t00, t01, t11);
        } else {
          this.triangle(p00, p10, p11, t00, t10, t11);
          this.triangle(p00, p11, p01, t00, t11, t01);
        }
      }
  }

  /** Thin diagonal band: full UV bounding box, very little covered area. */
  strip(options: {
    width: number;
    height: number;
    segments: number;
    thickness?: number;
    uv?: [number, number, number, number];
  }) {
    const { width, height, segments, thickness = 0.02, uv = [0, 0, 1, 1] } = options;
    const [u0, v0, u1, v1] = uv;
    const band = thickness;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      // Perpendicular offset keeps the triangles non-degenerate while the UV
      // bounding box stays the full 0..1 square.
      const a: Vec3 = [t0 * width, t0 * height, 0];
      const b: Vec3 = [t1 * width, t1 * height, 0];
      const c: Vec3 = [t1 * width - band, t1 * height + band, 0];
      const d: Vec3 = [t0 * width - band, t0 * height + band, 0];
      const ua: Vec2 = [u0 + (u1 - u0) * t0, v0 + (v1 - v0) * t0];
      const ub: Vec2 = [u0 + (u1 - u0) * t1, v0 + (v1 - v0) * t1];
      const uc: Vec2 = [u0 + (u1 - u0) * (t1 - band), v0 + (v1 - v0) * (t1 + band)];
      const ud: Vec2 = [u0 + (u1 - u0) * (t0 - band), v0 + (v1 - v0) * (t0 + band)];
      this.triangle(a, b, c, ua, ub, uc);
      this.triangle(a, c, d, ua, uc, ud);
    }
  }

  bounds(): [number, number, number, number] {
    const low: [number, number] = [Infinity, Infinity];
    const high: [number, number] = [-Infinity, -Infinity];
    for (let i = 0; i < this.uvs.length; i += 2) {
      low[0] = Math.min(low[0], this.uvs[i]!);
      low[1] = Math.min(low[1], this.uvs[i + 1]!);
      high[0] = Math.max(high[0], this.uvs[i]!);
      high[1] = Math.max(high[1], this.uvs[i + 1]!);
    }
    return [low[0], low[1], high[0], high[1]];
  }

  area(): number {
    return this.areas.reduce((sum, value) => sum + value, 0);
  }
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ) / 2
  );
}

interface InputOptions {
  id: string;
  material: string;
  part?: string;
  texture: RgbaImage | null;
  color?: [number, number, number];
  opacity?: number;
  alphaMode?: ChartInput['alphaMode'];
  alphaCutoff?: number;
  wrap?: ChartInput['wrap'];
  /** Override UV bounds; by default the soup bounds are used. */
  bounds?: [number, number, number, number] | null;
}

function finish(soup: Soup, options: InputOptions): ChartInput {
  const bounds = options.texture
    ? options.bounds === undefined
      ? soup.bounds()
      : options.bounds
    : null;
  const materialKey = `m:${options.id}`;
  return {
    id: options.id,
    material: options.material,
    materialKey,
    part: options.part ?? options.material,
    texture: options.texture,
    color: options.color ?? [1, 1, 1],
    opacity: options.opacity ?? 1,
    alphaMode: options.alphaMode ?? (options.texture ? 'MASK' : 'OPAQUE'),
    alphaCutoff: options.alphaCutoff ?? 0.5,
    wrap: options.wrap ?? ['repeat', 'repeat'],
    bounds,
    uvs: options.texture ? Float32Array.from(soup.uvs) : null,
    triangleAreas: options.texture ? Float32Array.from(soup.areas) : null,
    area: soup.area(),
  };
}

function planeInput(
  options: InputOptions & {
    width: number;
    height: number;
    origin?: Vec3;
    segments?: number;
    uv?: [number, number, number, number];
  },
): ChartInput {
  const soup = new Soup();
  soup.plane(options);
  return finish(soup, options);
}

/** Same material used by several primitives: one batch, several parts. */
function multiPartInput(
  options: InputOptions & {
    parts: { part: string; width: number; height: number; origin: Vec3; uv: [number, number, number, number] }[];
  },
): ChartInput {
  const soup = new Soup();
  for (const part of options.parts) {
    soup.plane({
      width: part.width,
      height: part.height,
      origin: part.origin,
      uv: part.uv,
    });
  }
  return finish(soup, { ...options, part: options.parts.map((p) => p.part).join('+') });
}

const checker = (key: string, size = 256) => makeImage(key, size, size, 'checker', 11);
const noise = (key: string, size = 256) => makeImage(key, size, size, 'noise', 23);

function sharedTextureFixture(): Fixture {
  const texture = checker('shared-checker', 256);
  const body = planeInput({
    id: 'body',
    material: 'Body',
    texture,
    width: 2,
    height: 2,
    segments: 8,
    uv: [0, 0, 0.5, 1],
  });
  const face = planeInput({
    id: 'face',
    material: 'Face',
    texture,
    width: 0.5,
    height: 0.5,
    segments: 8,
    uv: [0.5, 0, 1, 1],
  });
  return {
    name: 'shared-texture',
    description:
      'Body and Face share one 256² checker texture but occupy different UV halves. Body is 16x the world area; both need the same source detail per texel.',
    inputs: [body, face],
    focus: ['body', 'face'],
    notes:
      'Any planner that only budgets by world area downsamples the face far more than the body even though the source texel density is identical.',
  };
}

function sameTextureDifferentUvFixture(): Fixture {
  const texture = noise('uv-density', 512);
  const dense = planeInput({
    id: 'dense',
    material: 'DenseUV',
    texture,
    width: 1,
    height: 1,
    segments: 16,
    uv: [0, 0, 0.2, 0.2],
  });
  const spread = planeInput({
    id: 'spread',
    material: 'SpreadUV',
    texture,
    width: 1,
    height: 1,
    segments: 16,
    uv: [0, 0, 1, 1],
  });
  return {
    name: 'same-texture-different-uv',
    description:
      'Two materials sample the same 512² texture over different UV extents (0.2 vs 1.0). Identical world area, 25x difference in native source texels.',
    inputs: [dense, spread],
    focus: ['dense', 'spread'],
    notes:
      'Surface-area allocation gives both the same pixels, so the dense material is downsampled ~25x harder than the spread one.',
  };
}

function multiPartFixture(): Fixture {
  const texture = makeImage('multi-part', 512, 512, 'cloth', 31);
  return {
    name: 'multi-part-material',
    description:
      'One Cloth material spans body, skirt and sleeve primitives with different world scales and disjoint UV islands.',
    inputs: [
      multiPartInput({
        id: 'cloth',
        material: 'Cloth',
        texture,
        parts: [
          { part: 'body', width: 1, height: 1.4, origin: [0, 0, 0], uv: [0, 0, 0.6, 1] },
          { part: 'skirt', width: 1.2, height: 0.5, origin: [0, -0.5, 0], uv: [0.6, 0, 1, 0.4] },
          { part: 'sleeve', width: 0.3, height: 0.6, origin: [1.2, 0.2, 0], uv: [0.6, 0.4, 0.8, 1] },
        ],
      }),
    ],
    focus: ['cloth'],
    notes:
      'Part-level control is impossible today: the material is one batch, so deleting the sleeve cannot shrink the UV demand of the body.',
  };
}

function partDeletionFixture(): Fixture {
  const texture = makeImage('two-parts', 512, 512, 'cloth', 41);
  const body = planeInput({
    id: 'body',
    material: 'Body',
    part: 'body',
    texture,
    width: 1,
    height: 1,
    segments: 8,
    uv: [0, 0, 1, 1],
  });
  const prop = planeInput({
    id: 'prop',
    material: 'Prop',
    part: 'prop',
    texture,
    width: 0.2,
    height: 0.2,
    segments: 4,
    uv: [0, 0, 1, 1],
  });
  return {
    name: 'part-deletion',
    description:
      'Two parts each occupy the full 0..1 UV of the same 512² texture. Removing the prop must free its UV demand but not corrupt the body.',
    inputs: [body, prop],
    focus: ['body', 'prop'],
    notes:
      'Deleting a part is modeled by dropping its input; the remaining input keeps the same UVs and must stay correct.',
  };
}

function sparseIslandFixture(): Fixture {
  const texture = noise('sparse', 512);
  const soup = new Soup();
  soup.strip({ width: 1, height: 1, segments: 12, thickness: 0.02 });
  return {
    name: 'sparse-island',
    description:
      'One material whose UV bounding box is the full 0..1 square but whose triangles cover only a diagonal strip (~4%).',
    inputs: [finish(soup, { id: 'sparse', material: 'Sparse', texture })],
    focus: ['sparse'],
    notes:
      'A rectangle-based atlas reserves the whole box for 4% of real coverage. Reusing the empty part is only safe after proving no triangle samples it.',
  };
}

function overlappingUvFixture(): Fixture {
  const skin = makeImage('overlap-a', 256, 256, 'gradient', 51);
  const decal = makeImage('overlap-b', 256, 256, 'noise', 53);
  const make = (id: string, material: string, texture: RgbaImage) =>
    planeInput({
      id,
      material,
      texture,
      width: 1,
      height: 1,
      segments: 6,
      uv: [0, 0, 1, 1],
    });
  return {
    name: 'overlapping-uv',
    description:
      'Two materials with identical UVs and world area but different textures. Their UVs overlap completely.',
    inputs: [make('skin', 'Skin', skin), make('decal', 'Decal', decal)],
    focus: ['skin', 'decal'],
    notes:
      'Sharing must not merge two different source textures just because their UV boxes coincide.',
  };
}

function fewLargeManySmallFixture(): Fixture {
  const inputs: ChartInput[] = [];
  inputs.push(
    planeInput({
      id: 'hero',
      material: 'Hero',
      texture: makeImage('hero', 1024, 1024, 'cloth', 61),
      width: 2,
      height: 2,
      segments: 12,
      uv: [0, 0, 1, 1],
    }),
  );
  for (let i = 0; i < 24; i++)
    inputs.push(
      planeInput({
        id: `trim${i}`,
        material: `Trim${i}`,
        texture: makeImage(`trim${i}`, 64, 64, i % 2 ? 'noise' : 'checker', 100 + i),
        width: 0.1,
        height: 0.1,
        segments: 1,
        uv: [0, 0, 1, 1],
      }),
    );
  return {
    name: 'few-large-many-small',
    description:
      'One dominant Hero material plus 24 small trim materials, each with its own tiny texture.',
    inputs,
    focus: ['hero', 'trim0'],
    notes:
      'Sublinear area demand protects the trims, but it also makes the Hero allocation non-linear in its weight.',
  };
}

function characterFixture(): Fixture {
  const face = makeImage('char-face', 512, 512, 'face', 71);
  const cloth = makeImage('char-cloth', 1024, 1024, 'cloth', 73);
  const hair = makeImage('char-hair', 512, 512, 'hair', 79);
  const eye = makeImage('char-eye', 64, 64, 'solid', 83);
  const boot = makeImage('char-boot', 256, 256, 'noise', 89);
  const inputs: ChartInput[] = [
    planeInput({
      id: 'face',
      material: 'Face',
      texture: face,
      width: 0.22,
      height: 0.26,
      origin: [0, 1.6, 0],
      segments: 10,
      uv: [0, 0, 1, 1],
    }),
    planeInput({
      id: 'eyeL',
      material: 'EyeL',
      texture: eye,
      width: 0.03,
      height: 0.03,
      origin: [-0.05, 1.68, 0.01],
      segments: 2,
      uv: [0, 0, 1, 1],
    }),
    planeInput({
      id: 'eyeR',
      material: 'EyeR',
      texture: eye,
      width: 0.03,
      height: 0.03,
      origin: [0.03, 1.68, 0.01],
      segments: 2,
      uv: [0, 0, 1, 1],
    }),
    planeInput({
      id: 'body',
      material: 'Body',
      texture: cloth,
      width: 0.5,
      height: 1.2,
      origin: [0, 0.3, 0],
      segments: 20,
      uv: [0, 0, 0.7, 1],
    }),
    planeInput({
      id: 'skirt',
      material: 'Skirt',
      texture: cloth,
      width: 0.55,
      height: 0.5,
      origin: [0, 0.05, 0.02],
      segments: 12,
      uv: [0.7, 0, 1, 0.5],
    }),
    multiPartInput({
      id: 'hair',
      material: 'Hair',
      texture: hair,
      parts: Array.from({ length: 8 }, (_, i) => ({
        part: `strand${i}`,
        width: 0.6,
        height: 0.5,
        origin: [-0.3 + i * 0.01, 1.35 + i * 0.01, -0.02 - i * 0.002] as Vec3,
        uv: [0, i / 8, 1, (i + 1) / 8] as [number, number, number, number],
      })),
    }),
    planeInput({
      id: 'boots',
      material: 'Boots',
      texture: boot,
      width: 0.3,
      height: 0.2,
      origin: [0, -0.05, 0],
      segments: 6,
      uv: [0, 0, 1, 1],
    }),
  ];
  return {
    name: 'character',
    description:
      'Procedural character: detailed face, duplicate eye materials, large cloth body/skirt, eight hair strands and boots. Face is ~1% of the world area but carries most of the detail.',
    inputs,
    focus: ['face', 'body', 'hair'],
    notes:
      'The realistic failure mode of surface-area demand: face/eye quality collapses because cloth dominates the area budget.',
  };
}

function degenerateFixture(): Fixture {
  const texture = noise('degenerate', 128);
  const soup = new Soup();
  soup.plane({ width: 1, height: 1, segments: 2 });
  // Zero-area triangle in world space.
  soup.triangle([0, 0, 0], [1, 0, 0], [2, 0, 0], [0.1, 0.1], [0.2, 0.1], [0.3, 0.1]);
  // Zero-area UV triangle.
  soup.triangle([0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]);
  return {
    name: 'degenerate',
    description:
      'Normal quad plus a zero-world-area triangle and a zero-UV-area triangle. Must not crash or inflate demand.',
    inputs: [finish(soup, { id: 'degenerate', material: 'Degenerate', texture })],
    focus: ['degenerate'],
    notes: 'Zero-area UV still samples one texel; it must not create an infinite density.',
  };
}

function wrapModesFixture(): Fixture {
  const make = (id: string, material: string, wrap: ChartInput['wrap'], uv: [number, number, number, number]) =>
    planeInput({
      id,
      material,
      texture: noise(`wrap-${id}`, 128),
      width: 0.5,
      height: 0.5,
      segments: 4,
      uv,
      wrap,
    });
  return {
    name: 'wrap-modes',
    description:
      'Repeat, clamp and mirror samplers with UVs inside, crossing seams and negative.',
    inputs: [
      make('repeat', 'Repeat', ['repeat', 'repeat'], [-1, -1, 2, 2]),
      make('clamp', 'Clamp', ['clamp', 'clamp'], [0, 0, 1, 1]),
      make('mirror', 'Mirror', ['mirror', 'mirror'], [-0.5, -0.5, 1.5, 1.5]),
    ],
    focus: ['repeat'],
    notes: 'Atlas 大小 128 时，repeat 跨 seam 的岛必须保留 wrap 语义，不能只裁 0..1。',
  };
}

function tinyIslandsFixture(): Fixture {
  const texture = checker('tiny', 128);
  const soup = new Soup();
  for (let i = 0; i < 40; i++) {
    const x = (i % 8) * 0.02;
    const y = Math.floor(i / 8) * 0.02;
    soup.plane({
      width: 0.005,
      height: 0.005,
      origin: [x, y, 0],
      uv: [x, y, x + 0.002, y + 0.002],
    });
  }
  return {
    name: 'tiny-islands',
    description: '40 tiny UV islands of one material spread across a 0..0.16 box.',
    inputs: [finish(soup, { id: 'tiny', material: 'Tiny', texture })],
    focus: ['tiny'],
    notes: 'Island count can exceed the number of usable texels at 128² with padding.',
  };
}

export function fixtures(): Fixture[] {
  return [
    sharedTextureFixture(),
    sameTextureDifferentUvFixture(),
    multiPartFixture(),
    partDeletionFixture(),
    sparseIslandFixture(),
    overlappingUvFixture(),
    fewLargeManySmallFixture(),
    characterFixture(),
    degenerateFixture(),
    wrapModesFixture(),
    tinyIslandsFixture(),
  ];
}

export function fixtureByName(name: string): Fixture {
  const found = fixtures().find((fixture) => fixture.name === name);
  if (!found) throw new Error(`Unknown fixture: ${name}`);
  return found;
}
