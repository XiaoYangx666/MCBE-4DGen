import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { importModel } from '../../src/importer.ts';
import { getBounds } from '@gltf-transform/core';

// Diagnostic orthographic geometry preview, deliberately without PBR or texture rendering.
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error('Usage: node scripts/samples/preview-mesh.ts before.glb after.glb');
const tiles: string[] = [];
for (const [row, path] of paths.entries()) {
  const { document } = await importModel(path);
  const scene = document.getRoot().getDefaultScene()!;
  const bounds = getBounds(scene);
  const center = bounds.min.map((v, i) => (v + bounds.max[i]!) / 2);
  const scale = 290 / Math.max(...bounds.max.map((v, i) => v - bounds.min[i]!));
  for (const [column, yaw] of [0.7, 1.57].entries()) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw), pitch = 0.35, sp = Math.sin(pitch), cp = Math.cos(pitch);
    const faces: { z: number; path: string }[] = [];
    scene.traverse((node) => {
      const matrix = node.getWorldMatrix();
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION')!;
        const vertices = Array.from({ length: position.getCount() }, (_, i) => {
          const v: number[] = []; position.getElement(i, v);
          const x = matrix[0]! * v[0]! + matrix[4]! * v[1]! + matrix[8]! * v[2]! + matrix[12]! - center[0]!;
          const y = matrix[1]! * v[0]! + matrix[5]! * v[1]! + matrix[9]! * v[2]! + matrix[13]! - center[1]!;
          const z = matrix[2]! * v[0]! + matrix[6]! * v[1]! + matrix[10]! * v[2]! + matrix[14]! - center[2]!;
          return [cy * x - sy * z, -sp * (sy * x + cy * z) + cp * y, cp * (sy * x + cy * z) + sp * y];
        });
        const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: position.getCount() }, (_, i) => i);
        for (let i = 0; i < indices.length; i += 3) {
          const a = vertices[indices[i]!]!, b = vertices[indices[i + 1]!]!, c = vertices[indices[i + 2]!]!;
          const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
          const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
          const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
          const shade = Math.round(95 + 135 * Math.abs((n[0]! * 0.2 + n[1]! * 0.7 + n[2]! * 0.6) / (Math.hypot(...n) || 1)));
          faces.push({ z: (a[2]! + b[2]! + c[2]!) / 3,
            path: `<path d="M${[a, b, c].map((v) => `${(200 + v[0]! * scale).toFixed(2)},${(190 - v[1]! * scale).toFixed(2)}`).join('L')}Z" fill="rgb(${shade - 20},${shade},${Math.min(255, shade + 15)})"/>` });
        }
      }
    });
    faces.sort((a, b) => a.z - b.z);
    tiles.push(`<g transform="translate(${column * 400},${row * 360})"><text x="20" y="28" fill="white" font-size="18">${row ? 'Simplified' : 'Original'} — ${column ? 'side' : 'angled'}</text>${faces.map((f) => f.path).join('')}</g>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="720"><rect width="800" height="720" fill="#26303d"/>${tiles.join('')}</svg>`;
await writeFile('.cache/samples/mesh-preview.png', await sharp(Buffer.from(svg)).png().toBuffer());
console.log('.cache/samples/mesh-preview.png');
