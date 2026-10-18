import { test } from 'bun:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { documentFixture } from './fixtures.ts';
import { optimizeModel } from '../src/optimizer.ts';
import type { IntermediateModel } from '../src/model.ts';
import { bindStatic } from '../src/bone-mapper.ts';
import { exportBedrockGeometry } from '../src/bedrock-exporter.ts';
import { decodeGeometryTriangles, parseGeometryJSON } from '../src/geometry-validator.ts';

async function prepared() {
  const input: IntermediateModel = { document: await documentFixture(),
    source: { path: 'generated', format: 'gltf', importer: 'gltf-transform', units: 'meters', coordinates: 'right-handed-y-up' }, warnings: [] };
  return (await optimizeModel(input, { prepare: {}, mesh: { preset: 'original' }, texture: { maxTextureSize: 8, atlasSize: 32 } })).model;
}
const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-6, `${a} != ${b}`));

test('skin atlas limit resizes PNG and dimensions together without changing normalized mesh data', async () => {
  const model = await prepared();
  const texture = model.document.getRoot().listMaterials()[0]!.getBaseColorTexture()!;
  texture.setImage(await sharp(texture.getImage()!).resize(512, 512).png().toBuffer());
  const binding = bindStatic(model);
  const original = await exportBedrockGeometry(binding, { identifier: 'geometry.fixture' });
  const limited = await exportBedrockGeometry(binding, { identifier: 'geometry.fixture', skinTextureSize: 128 });
  const png = await sharp(limited.png).metadata();
  assert.equal(png.width, 128); assert.equal(png.height, 128);
  assert.equal(limited.file['geometry.fixture']!.texturewidth, 128);
  assert.equal(limited.file['geometry.fixture']!.textureheight, 128);
  assert.deepEqual(limited.file['geometry.fixture']!.bones, original.file['geometry.fixture']!.bones);
  assert.equal((await sharp(texture.getImage()!).metadata()).width, 512);
});

test('legacy export uses independent position/normal/UV indices and repeated triangle corner', async () => {
  const model = await prepared();
  const result = await exportBedrockGeometry(bindStatic(model), { identifier: 'geometry.fixture' });
  const parsed = parseGeometryJSON(JSON.stringify(result.file), { textureSize: { width: 32, height: 32 }, atlasUVs: true });
  assert.equal(parsed.geometries[0]!.triangles, 2);
  assert.equal(parsed.geometries[0]!.paddedTriangles, 2);
  const geometry = parsed.file['geometry.fixture']!, mesh = geometry.bones.find((b) => b.name === 'body')!.poly_mesh!;
  assert.equal(mesh.positions.length, 6);
  assert.equal(mesh.normals.length, 1);
  assert.equal(mesh.uvs.length, 3);
  for (const poly of mesh.polys) { assert.equal(poly.length, 4); assert.deepEqual(poly[2], poly[3]); }
  const triangles = decodeGeometryTriangles(parsed.file, 'geometry.fixture');
  const source = model.document.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  for (const [t, primitive] of source.entries()) for (let i = 0; i < 3; i++) {
    const index = primitive.getIndices()!.getScalar(i), p: number[] = [], n: number[] = [], uv: number[] = [];
    primitive.getAttribute('POSITION')!.getElement(index, p); primitive.getAttribute('NORMAL')!.getElement(index, n); primitive.getAttribute('TEXCOORD_0')!.getElement(index, uv);
    close(triangles[t]![i]!.position, [-p[0]!, p[1]!, p[2]!]);
    close(triangles[t]![i]!.normal, [-n[0]!, n[1]!, n[2]!]);
    close(triangles[t]![i]!.uv, [uv[0]!, 1 - uv[1]!]);
  }
  close(triangles[0]![0]!.position, [-12, 0, 0]);
  close(triangles[0]![0]!.uv, [2 / 32, 1 - 2 / 32]);
  assert.ok(geometry.bones.every((b) => !('cubes' in b)));
  assert.equal(result.file.format_version, '1.8.0');
});

test('attachment, position and pivot are separate; pivot does not shift rest geometry', async () => {
  const model = await prepared();
  const binding = bindStatic(model, { bone: 'head', position: [2, 3, 4], pivot: [5, 6, 7] });
  const result = await exportBedrockGeometry(binding, { identifier: 'geometry.head_prop' });
  const bones = result.file['geometry.head_prop']!.bones;
  const head = bones.find((b) => b.name === 'head')!;
  assert.equal(head.parent, 'body'); close(head.pivot!, [-5, 6, 7]);
  close(head.poly_mesh!.positions[0]!, [-14, 3, 4]);
  const other = await exportBedrockGeometry(bindStatic(model, { bone: 'head', position: [2, 3, 4] }), { identifier: 'geometry.head_prop' });
  assert.deepEqual(other.file['geometry.head_prop']!.bones.find((b) => b.name === 'head')!.poly_mesh, head.poly_mesh);
  assert.equal(model.document.getRoot().listNodes()[0]!.getName(), 'child');
  assert.ok(!('bones' in model));
});

test('double-sided policy counts explicit backfaces and reverses their normals and order', async () => {
  const model = await prepared(); model.document.getRoot().listMaterials()[0]!.setDoubleSided(true);
  const binding = bindStatic(model);
  const result = await exportBedrockGeometry(binding, { identifier: 'geometry.two_sided' });
  assert.equal(result.report.sourceTriangles, 2); assert.equal(result.report.addedBackfaces, 2); assert.equal(result.report.triangles, 4);
  const triangles = decodeGeometryTriangles(result.file, 'geometry.two_sided');
  close(triangles[1]![0]!.position, triangles[0]![2]!.position);
  close(triangles[1]![0]!.normal, triangles[0]![2]!.normal.map((v) => -v));
  const front = await exportBedrockGeometry(binding, { identifier: 'geometry.two_sided', doubleSided: 'front-only' });
  assert.equal(front.report.triangles, 2);
  assert.ok(front.report.warnings.some((w) => w.includes('not preserved')));
});

test('unprepared model, invalid identifiers, invalid pivots and unbaked material fail', async () => {
  const model = await prepared(), binding = bindStatic(model);
  assert.throws(() => bindStatic({ ...model, preparation: undefined } as unknown as IntermediateModel), /prepared rigid/);
  assert.throws(() => bindStatic(model, { pivot: [NaN, 0, 0] }), /finite/);
  await assert.rejects(exportBedrockGeometry(binding, { identifier: '../bad' }), /identifier/);
  model.document.getRoot().listMaterials()[0]!.setBaseColorFactor([0.5, 1, 1, 1]);
  await assert.rejects(exportBedrockGeometry(binding, { identifier: 'geometry.bad' }), /must be baked/);
});
