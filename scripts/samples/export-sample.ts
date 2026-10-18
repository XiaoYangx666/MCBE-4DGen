import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { importModel } from '../../src/importer.ts';
import { optimizeModel } from '../../src/optimizer.ts';
import { bindStatic } from '../../src/bone-mapper.ts';
import { exportBedrockGeometry } from '../../src/bedrock-exporter.ts';
import { decodeGeometryTriangles, parseGeometryJSON } from '../../src/geometry-validator.ts';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2] ?? 'ToyCar');
const optimized = await optimizeModel(await importModel(sample.path), {
  prepare: { height: 32, center: 'ground' }, mesh: { ratio: 0.5, maxError: 0.001 },
  texture: { maxTextureSize: 256, atlasSize: 2048 },
});
const identifier: `geometry.${string}` = `geometry.${sample.name.toLowerCase()}`;
const result = await exportBedrockGeometry(bindStatic(optimized.model), { identifier });
const geometryPath = `.cache/samples/${sample.name}.geometry.json`, texturePath = `.cache/samples/${sample.name}.skin.png`;
await writeFile(geometryPath, JSON.stringify(result.file));
await writeFile(texturePath, result.png);
const png = await sharp(await readFile(texturePath)).metadata();
const reread = parseGeometryJSON(await readFile(geometryPath, 'utf8'), { expectedIdentifier: identifier,
  textureSize: { width: png.width!, height: png.height! }, atlasUVs: true });
assert.equal(reread.geometries[0]!.triangles, result.report.triangles);
assert.equal(reread.geometries[0]!.paddedTriangles, result.report.triangles);
assert.equal(result.report.sourceTriangles, optimized.report.mesh.after);
const decoded = decodeGeometryTriangles(reread.file, identifier);
let triangle = 0;
// Compare every exported front/back corner against the independently retained optimized input.
for (const mesh of optimized.model.document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const indices = p.getIndices()!.getArray()!;
  for (let i = 0; i < indices.length; i += 3) {
    for (const back of p.getMaterial()!.getDoubleSided() ? [false, true] : [false]) {
      const actual = decoded[triangle++]!;
      for (let c = 0; c < 3; c++) {
        const index = indices[i + (back ? 2 - c : c)]!, position: number[] = [], uv: number[] = [], normal: number[] = [];
        p.getAttribute('POSITION')!.getElement(index, position); p.getAttribute('TEXCOORD_0')!.getElement(index, uv); p.getAttribute('NORMAL')!.getElement(index, normal);
        const sign = back ? -1 : 1, length = Math.hypot(...normal);
        const expected = [...[-position[0]!, position[1]!, position[2]!], ...[-sign * normal[0]! / length, sign * normal[1]! / length, sign * normal[2]! / length], uv[0]!, 1 - uv[1]!];
        const values = [...actual[c]!.position, ...actual[c]!.normal, ...actual[c]!.uv];
        assert.ok(values.every((v, j) => Math.abs(v - expected[j]!) < 1e-6), `Corner mismatch in triangle ${triangle - 1}`);
      }
    }
  }
}
assert.equal(triangle, decoded.length);
const report = { sample: sample.name, geometryPath, texturePath, geometryBytes: (await readFile(geometryPath)).length,
  ...result.report, compatibility: { formatValidation: 'passed', thirdPartyLoader: 'not tested', vanillaWearable: 'not tested' } };
await writeFile(`.cache/samples/${sample.name}-geometry-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sample: sample.name, sourceTriangles: result.report.sourceTriangles, addedBackfaces: result.report.addedBackfaces,
  finalTriangles: result.report.triangles, geometryBytes: report.geometryBytes, geometryPath, texturePath, validation: 'passed; all corners round-tripped' }, null, 2));
