import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';
import { previewOutput } from '../src/preview.ts';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';

if (!process.argv[2]) throw new Error('Usage: bun run binding:preview <generated-pack-directory> [output-prefix]');
const source = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'outputs/binding-preview');
await mkdir(dirname(output), { recursive: true });
const original = JSON.parse(await readFile(resolve(source, 'geometry.json'), 'utf8')) as BedrockGeometryFile;
const identifier = Object.keys(original).find((key) => key.startsWith('geometry.'))! as `geometry.${string}`;
const names = ['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const colors = [[40, 130, 240], [245, 220, 70], [250, 70, 65], [245, 145, 40], [50, 205, 130], [150, 90, 225]];
const pixels = new Uint8Array(128 * 128 * 4);
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const rgb = colors[Math.min(5, Math.floor(x / 128 * 6))]!;
  pixels.set([...rgb, 255], (y * 128 + x) * 4);
}
await mkdir('.cache/binding-preview', { recursive: true });
await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toFile('.cache/binding-preview/ownership.png');
for (const [label, walking, colored] of [['ownership', false, true], ['ownership-walk', true, true], ['walk', true, false]] as const) {
  const file = structuredClone(original), geometry = file[identifier]!;
  for (const bone of geometry.bones) {
    const mesh = bone.poly_mesh; if (!mesh) continue;
    if (colored) {
      const index = names.indexOf(bone.name);
      mesh.uvs = [[(index + 0.5) / 6, 0.5]];
      for (const poly of mesh.polys) for (const ref of poly) ref[2] = 0;
    }
    if (walking && /Arm|Leg/.test(bone.name)) {
      const degrees = bone.name === 'leftArm' || bone.name === 'rightLeg' ? 35 : -35;
      const r = degrees * Math.PI / 180, pivot = bone.pivot!;
      for (const p of mesh.positions) {
        const y = p[1] - pivot[1], z = p[2] - pivot[2];
        p[1] = pivot[1] + y * Math.cos(r) - z * Math.sin(r);
        p[2] = pivot[2] + y * Math.sin(r) + z * Math.cos(r);
      }
      for (const n of mesh.normals) { const y = n[1], z = n[2]; n[1] = y * Math.cos(r) - z * Math.sin(r); n[2] = y * Math.sin(r) + z * Math.cos(r); }
    }
  }
  const path = `.cache/binding-preview/${label}.json`;
  await writeFile(path, JSON.stringify(file));
  const result = await previewOutput(path, { texture: colored ? '.cache/binding-preview/ownership.png' : resolve(source, 'skin0.png'), size: 256, unlit: true });
  await writeFile(`${output}-${label}.png`, result.png, { flag: 'wx' });
  console.log(`${output}-${label}.png`);
}
