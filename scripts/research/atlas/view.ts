/**
 * Fixed-view software render for visual comparison.
 *
 * Renders the same geometry twice from the same orthographic camera:
 * - reference: sample the original source texture with the original UVs
 * - candidate: sample the baked 128² atlas with the remapped UVs
 *
 * Both use a footprint-aware box filter (UV area per screen pixel), so the
 * difference measures resolution loss rather than aliasing luck. Lighting is
 * disabled: this is a texture-quality comparison, not a material preview.
 */
import { bakeSample, sampleArea, sampleAtlasLinear, toSrgbByte, type Rgba } from './sample.ts';
import type { ChartInput, RgbaImage } from './types.ts';

export interface ViewOptions {
  width?: number;
  height?: number;
  /** Rotation around Y in degrees. */
  yaw?: number;
  /** Rotation around X in degrees. */
  pitch?: number;
  background?: [number, number, number];
  /** Magnification relative to the fit-to-frame scale. */
  zoom?: number;
  /** World Y to center, 0 = model bottom, 1 = model top. */
  focusY?: number;
}

export interface ViewComparison {
  reference: RgbaImage;
  candidate: RgbaImage;
  diff: RgbaImage;
  coveredPixels: number;
  meanError: number;
  p95Error: number;
}

type Vec3 = [number, number, number];

const rotate = (point: Vec3, yaw: number, pitch: number): Vec3 => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x = point[0] * cy + point[2] * sy;
  const z = -point[0] * sy + point[2] * cy;
  const y = point[1] * cp - z * sp;
  const z2 = point[1] * sp + z * cp;
  return [x, y, z2];
};

export function renderComparison(
  inputs: readonly ChartInput[],
  atlas: RgbaImage,
  atlasUvs: Map<string, Float32Array>,
  options: ViewOptions = {},
): ViewComparison {
  const width = options.width ?? 384;
  const height = options.height ?? 512;
  const yaw = ((options.yaw ?? 22) * Math.PI) / 180;
  const pitch = ((options.pitch ?? -6) * Math.PI) / 180;
  const background = options.background ?? [26, 27, 32];

  // World bounds over every triangle that has positions.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const input of inputs) {
    const positions = input.positions;
    if (!positions) continue;
    for (let i = 0; i < positions.length; i += 3) {
      const p = rotate([positions[i]!, positions[i + 1]!, positions[i + 2]!], yaw, pitch);
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
  }
  if (!Number.isFinite(minX))
    return {
      reference: {
        width,
        height,
        data: new Uint8Array(width * height * 4).fill(255),
        key: 'empty',
      },
      candidate: {
        width,
        height,
        data: new Uint8Array(width * height * 4).fill(255),
        key: 'empty',
      },
      diff: {
        width,
        height,
        data: new Uint8Array(width * height * 4).fill(255),
        key: 'empty',
      },
      coveredPixels: 0,
      meanError: 0,
      p95Error: 0,
    };

  const scale =
    Math.min(
      (width * 0.92) / Math.max(1e-6, maxX - minX),
      (height * 0.92) / Math.max(1e-6, maxY - minY),
    ) * (options.zoom ?? 1);
  const cx = width / 2 - ((minX + maxX) / 2) * scale;
  const focusWorldY =
    options.focusY !== undefined
      ? minY + (maxY - minY) * options.focusY
      : (minY + maxY) / 2;
  const cy = height / 2 + focusWorldY * scale;
  const depthRange = Math.max(1e-6, maxZ - minZ);

  const referenceData = new Uint8Array(width * height * 4);
  const candidateData = new Uint8Array(width * height * 4);
  const diffData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    referenceData[i * 4] = background[0]!;
    referenceData[i * 4 + 1] = background[1]!;
    referenceData[i * 4 + 2] = background[2]!;
    referenceData[i * 4 + 3] = 255;
    candidateData[i * 4] = background[0]!;
    candidateData[i * 4 + 1] = background[1]!;
    candidateData[i * 4 + 2] = background[2]!;
    candidateData[i * 4 + 3] = 255;
    diffData[i * 4] = 0;
    diffData[i * 4 + 1] = 0;
    diffData[i * 4 + 2] = 0;
    diffData[i * 4 + 3] = 255;
  }
  const depth = new Float32Array(width * height).fill(Infinity);
  const errors: number[] = [];

  for (const input of inputs) {
    const positions = input.positions;
    const source = input.texture;
    const original = input.uvs;
    const mapped = atlasUvs.get(input.id);
    if (!positions || !source || !original || !mapped) continue;
    const triangles = Math.min(
      Math.floor(positions.length / 9),
      Math.floor(original.length / 6),
    );
    const bake = {
      color: input.color,
      opacity: input.opacity,
      alphaMode: input.alphaMode,
      alphaCutoff: input.alphaCutoff,
    };
    for (let t = 0; t < triangles; t++) {
      const world: Vec3[] = [];
      const screen: Vec3[] = [];
      for (let corner = 0; corner < 3; corner++) {
        const p = rotate(
          [
            positions[t * 9 + corner * 3]!,
            positions[t * 9 + corner * 3 + 1]!,
            positions[t * 9 + corner * 3 + 2]!,
          ],
          yaw,
          pitch,
        );
        world.push(p);
        screen.push([cx + p[0] * scale, cy - p[1] * scale, (p[2] - minZ) / depthRange]);
      }
      const [a, b, c] = screen as [Vec3, Vec3, Vec3];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      if (x1 < x0 || y1 < y0) continue;

      const uv0: [number, number] = [original[t * 6]!, original[t * 6 + 1]!];
      const uv1: [number, number] = [original[t * 6 + 2]!, original[t * 6 + 3]!];
      const uv2: [number, number] = [original[t * 6 + 4]!, original[t * 6 + 5]!];
      const auv0: [number, number] = [mapped[t * 6]!, mapped[t * 6 + 1]!];
      const auv1: [number, number] = [mapped[t * 6 + 2]!, mapped[t * 6 + 3]!];
      const auv2: [number, number] = [mapped[t * 6 + 4]!, mapped[t * 6 + 5]!];
      const sourceArea =
        Math.abs(
          (uv1[0] - uv0[0]) * (uv2[1] - uv0[1]) -
            (uv1[1] - uv0[1]) * (uv2[0] - uv0[0]),
        ) / 2;
      const atlasArea =
        Math.abs(
          (auv1[0] - auv0[0]) * (auv2[1] - auv0[1]) -
            (auv1[1] - auv0[1]) * (auv2[0] - auv0[0]),
        ) / 2;
      const screenArea = Math.abs(area) / 2;
      const sourceFootprint =
        screenArea > 1e-9 ? Math.sqrt(sourceArea / screenArea) : 0;
      const atlasFootprint =
        screenArea > 1e-9 ? Math.sqrt(atlasArea / screenArea) : 0;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const index = y * width + x;
          if (z >= depth[index]!) continue;
          depth[index] = z;

          const su = w0 * uv0[0] + w1 * uv1[0] + w2 * uv2[0];
          const sv = w0 * uv0[1] + w1 * uv1[1] + w2 * uv2[1];
          const au = w0 * auv0[0] + w1 * auv1[0] + w2 * auv2[0];
          const av = w0 * auv0[1] + w1 * auv1[1] + w2 * auv2[1];
          const half = Math.max(sourceFootprint, atlasFootprint) * 0.5;
          const reference = bakeSample(
            sampleArea(
              source,
              su - half,
              sv - half,
              su + half,
              sv + half,
              input.wrap[0],
              input.wrap[1],
            ),
            bake,
          );
          const candidate = sampleAtlasLinear(atlas, au, av);
          const composite = (value: Rgba): Rgba => [
            value[0] * value[3] + (background[0]! / 255) * (1 - value[3]),
            value[1] * value[3] + (background[1]! / 255) * (1 - value[3]),
            value[2] * value[3] + (background[2]! / 255) * (1 - value[3]),
            1,
          ];
          const shownReference = composite(reference);
          const shownCandidate = composite(candidate);
          for (const [target, value] of [
            [referenceData, shownReference],
            [candidateData, shownCandidate],
          ] as const) {
            target[index * 4] = toSrgbByte(value[0]);
            target[index * 4 + 1] = toSrgbByte(value[1]);
            target[index * 4 + 2] = toSrgbByte(value[2]);
            target[index * 4 + 3] = 255;
          }
          const difference =
            (Math.abs(reference[0] * reference[3] - candidate[0] * candidate[3]) +
              Math.abs(reference[1] * reference[3] - candidate[1] * candidate[3]) +
              Math.abs(reference[2] * reference[3] - candidate[2] * candidate[3])) /
            3;
          errors.push(difference);
          const level = Math.min(255, Math.round(Math.sqrt(difference) * 255 * 1.6));
          diffData[index * 4] = level;
          diffData[index * 4 + 1] = Math.round(level * 0.35);
          diffData[index * 4 + 2] = Math.round(level * 0.2);
          diffData[index * 4 + 3] = 255;
        }
      }
    }
  }

  errors.sort((a, b) => a - b);
  const mean = errors.length
    ? errors.reduce((sum, value) => sum + value, 0) / errors.length
    : 0;
  return {
    reference: { width, height, data: referenceData, key: 'reference' },
    candidate: { width, height, data: candidateData, key: 'candidate' },
    diff: { width, height, data: diffData, key: 'diff' },
    coveredPixels: errors.length,
    meanError: mean,
    p95Error: errors.length
      ? errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))]!
      : 0,
  };
}
