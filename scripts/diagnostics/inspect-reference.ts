import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const path = process.argv[2];
if (!path) throw new Error('Usage: bun run scripts/diagnostics/inspect-reference.ts archive.zip [--allow-final-comma]');
const bytes = await readFile(path), zip = await JSZip.loadAsync(bytes);
const entry = Object.values(zip.files).find((entry) => /(^|\/)geometry\.json$/i.test(entry.name));
if (!entry) throw new Error('No geometry.json in archive');
const original = (await entry.async('string')).replace(/^\uFEFF/, '');
let data: Record<string, unknown>, repairedFinalComma = false;
try { data = JSON.parse(original); }
catch (error) {
  if (!process.argv.includes('--allow-final-comma') || !/,\s*}\s*$/.test(original)) throw error;
  // Reference inspection only, in memory. Never write changed bytes or use this in validation.
  data = JSON.parse(original.replace(/,\s*}(\s*)$/, '}$1')); repairedFinalComma = true;
}
const stats = { geometries: 0, polyBones: 0, positions: 0, normals: 0, uvs: 0, polygons: 0,
  threeCorner: 0, fourCorner: 0, paddedTriangles: 0, invalidIndices: 0, normalized: 0 };
for (const [name, value] of Object.entries(data)) {
  if (!name.startsWith('geometry.') || typeof value !== 'object' || !value) continue;
  stats.geometries++;
  const geometry = value as { bones?: { poly_mesh?: { normalized_uvs?: boolean; positions: unknown[]; normals: unknown[]; uvs: unknown[]; polys: number[][][] } }[] };
  for (const bone of geometry.bones ?? []) {
    const p = bone.poly_mesh; if (!p || !Array.isArray(p.polys)) continue;
    stats.polyBones++; stats.positions += p.positions.length; stats.normals += p.normals.length; stats.uvs += p.uvs.length;
    if (p.normalized_uvs) stats.normalized++;
    for (const poly of p.polys) {
      stats.polygons++;
      if (poly.length === 3) stats.threeCorner++;
      if (poly.length === 4) stats.fourCorner++;
      if (poly.length === 4 && JSON.stringify(poly[2]) === JSON.stringify(poly[3])) stats.paddedTriangles++;
      for (const r of poly) for (let i = 0; i < 3; i++) {
        const index = r[i];
        if (!Number.isInteger(index) || index! < 0 || index! >= [p.positions.length, p.normals.length, p.uvs.length][i]!) stats.invalidIndices++;
      }
    }
  }
}
console.log(JSON.stringify({ archiveSHA256: createHash('sha256').update(bytes).digest('hex'), geometryBytes: Buffer.byteLength(original),
  formatVersion: data.format_version, repairedFinalComma, stats }, null, 2));
