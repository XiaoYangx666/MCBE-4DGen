import sharp from 'sharp';
import type { BedrockGeometryFile, V3 } from './bedrock-types.ts';
import { decodeGeometryTriangles, validateGeometry } from './geometry-validator.ts';

type Corner = { position: V3; normal: V3; uv: [number, number] };
export interface PreviewOptions {
  identifier?: string;
  /** Width/height of each of four viewports; labels add 24 pixels per row. */
  size?: number;
  cullBackfaces?: boolean;
  unlit?: boolean;
}
const views = [
  { label: '+Z view | X right, Y up', yaw: 0, pitch: 0 },
  { label: '-Z view | X left, Y up', yaw: Math.PI, pitch: 0 },
  { label: '+X view | Z left, Y up', yaw: Math.PI / 2, pitch: 0 },
  { label: 'Angled +X/+Z view', yaw: Math.PI / 4, pitch: 0.3 },
];
const rotate = (v: number[], yaw: number, pitch: number): V3 => {
  const [x, y, z] = v as V3, c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [c * x - s * z, -sp * (s * x + c * z) + cp * y, cp * (s * x + c * z) + sp * y];
};
const edge = (a: number[], b: number[], x: number, y: number) =>
  (b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!);

/** CPU orthographic preview of the actual Bedrock streams, without invoking Importer or Exporter.
 * Bedrock reflected geometry uses clockwise front faces in this projection (positive screen area).
 * Opaque depth is per pixel. Translucent triangles are sorted back-to-front; intersections may differ
 * from the client. Nearest/clamped texture sampling; this is a diagnostic, not a Minecraft renderer.
 */
export async function renderGeometryPreview(file: BedrockGeometryFile, png: Uint8Array, options: PreviewOptions = {}) {
  const size = options.size ?? 384;
  if (!Number.isSafeInteger(size) || size < 64 || size > 1024) throw new Error('Preview size must be an integer from 64 to 1024');
  const image = await sharp(png).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if ((await sharp(png).metadata()).format !== 'png') throw new Error('Preview texture must be PNG');
  // Dimensions may differ between geometry definitions; validate only the selected one against PNG.
  const validation = validateGeometry(file);
  const identifier = options.identifier ?? (validation.geometries.length === 1 ? validation.geometries[0]!.identifier : undefined);
  if (!identifier) throw new Error('Multiple geometries: select one with --geometry');
  const selected = validation.geometries.find((g) => g.identifier === identifier);
  if (!selected) throw new Error('Preview geometry not found: ' + identifier);
  const geometry = file[selected.identifier]!;
  if (geometry.texturewidth !== image.info.width || geometry.textureheight !== image.info.height) throw new Error('Preview texture dimensions do not match geometry');
  if (geometry.bones.some((bone) => bone.rotation?.some((n) => n !== 0))) throw new Error('Preview currently supports static bones without rest rotations');
  const triangles = decodeGeometryTriangles(file, selected.identifier);
  const center = selected.bounds.min.map((v, i) => v / 2 + selected.bounds.max[i]! / 2);
  const diameter = Math.hypot(...selected.bounds.max.map((v, i) => v - selected.bounds.min[i]!));
  if (!Number.isFinite(diameter) || diameter <= 0) throw new Error('Preview bounds exceed supported numeric range');
  const scale = size * 0.86 / diameter;
  const width = size * 2, height = (size + 24) * 2;
  const pixels = Buffer.alloc(width * height * 4);
  const set = (x: number, y: number, color: number[]) => {
    const offset = (y * width + x) * 4;
    for (let i = 0; i < 4; i++) pixels[offset + i] = color[i]!;
  };
  const labels: string[] = [];
  for (const [viewIndex, view] of views.entries()) {
    const ox = (viewIndex % 2) * size, oy = Math.floor(viewIndex / 2) * (size + 24) + 24;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const shade = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 48 : 60;
      set(ox + x, oy + y, [shade, shade + 3, shade + 7, 255]);
    }
    const depth = new Float64Array(size * size).fill(-Infinity);
    const projected = triangles.map((tri) => {
      const corners = tri.map((c) => {
        const v = rotate(c.position.map((n, i) => n - center[i]!), view.yaw, view.pitch);
        return { position: [size / 2 + v[0] * scale, size / 2 - v[1] * scale, v[2]] as V3,
          normal: rotate(c.normal, view.yaw, view.pitch), uv: c.uv };
      });
      return { corners, z: corners.reduce((sum, c) => sum + c.position[2], 0) / 3 };
    }).sort((a, b) => a.z - b.z);
    // Opaque first, then transparent: transparent fragments never overwrite the opaque depth buffer.
    for (const transparent of [false, true]) for (const { corners } of projected) {
      const [a, b, c] = corners as [Corner, Corner, Corner];
      const area = edge(a.position, b.position, c.position[0], c.position[1]);
      if (Math.abs(area) < 1e-10 || (options.cullBackfaces !== false && area < 0)) continue;
      const minX = Math.max(0, Math.floor(Math.min(a.position[0], b.position[0], c.position[0])));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(a.position[0], b.position[0], c.position[0])));
      const minY = Math.max(0, Math.floor(Math.min(a.position[1], b.position[1], c.position[1])));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(a.position[1], b.position[1], c.position[1])));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const wa = edge(b.position, c.position, x + 0.5, y + 0.5) / area;
        const wb = edge(c.position, a.position, x + 0.5, y + 0.5) / area;
        const wc = edge(a.position, b.position, x + 0.5, y + 0.5) / area;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        // Top-left ownership prevents a shared edge being alpha-blended twice.
        const owns = (p: V3, q: V3) => {
          const dy = (q[1] - p[1]) * Math.sign(area), dx = (q[0] - p[0]) * Math.sign(area);
          return dy < 0 || (dy === 0 && dx > 0);
        };
        if ((wa === 0 && !owns(b.position, c.position)) || (wb === 0 && !owns(c.position, a.position)) ||
          (wc === 0 && !owns(a.position, b.position))) continue;
        const z = wa * a.position[2] + wb * b.position[2] + wc * c.position[2];
        const di = y * size + x;
        if (z < depth[di]!) continue;
        const interpolate = (field: 'uv' | 'normal', axis: number) => wa * a[field][axis]! + wb * b[field][axis]! + wc * c[field][axis]!;
        const u = interpolate('uv', 0), v = interpolate('uv', 1);
        // Bedrock poly_mesh V is bottom-origin; PNG rows are top-origin.
        const tx = Math.max(0, Math.min(image.info.width - 1, Math.floor(u * image.info.width)));
        const ty = Math.max(0, Math.min(image.info.height - 1, Math.floor((1 - v) * image.info.height)));
        const ti = (ty * image.info.width + tx) * 4, alpha = image.data[ti + 3]!;
        if (!alpha || (transparent ? alpha === 255 : alpha !== 255)) continue;
        const normal = [0, 1, 2].map((axis) => interpolate('normal', axis));
        const light = options.unlit ? 1 : 0.35 + 0.65 * Math.max(0,
          (normal[0]! * -0.3 + normal[1]! * 0.6 + normal[2]! * 0.74162) / (Math.hypot(...normal) || 1));
        const target = ((oy + y) * width + ox + x) * 4, opacity = alpha / 255;
        for (let channel = 0; channel < 3; channel++) pixels[target + channel] = Math.round(
          image.data[ti + channel]! * light * opacity + pixels[target + channel]! * (1 - opacity));
        pixels[target + 3] = 255;
        if (!transparent) depth[di] = z;
      }
    }
    labels.push(`<text x="${ox + 10}" y="${oy - 7}" fill="#ffffff" font-family="sans-serif" font-size="12">${view.label}</text>`);
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join('')}</svg>`);
  const output = await sharp(pixels, { raw: { width, height, channels: 4 } }).composite([{ input: overlay }]).png().toBuffer();
  return { png: output, identifier: selected.identifier, triangles: selected.triangles, width, height,
    warnings: ['Diagnostic only; not a Minecraft client compatibility test.', 'Intersecting transparent surfaces use approximate triangle sorting.'] };
}
