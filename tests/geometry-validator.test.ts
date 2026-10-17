import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { decodeGeometryTriangles, parseGeometryJSON, validateGeometry } from '../src/geometry-validator.ts';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';

// Independently authored asymmetric fixture, not extracted third-party geometry.
function fixture(): BedrockGeometryFile {
  return { format_version: '1.8.0', 'geometry.calibration': { texturewidth: 4, textureheight: 4, bones: [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'body', parent: 'root', pivot: [0, 10, 0], poly_mesh: { normalized_uvs: true,
      positions: [[0, 10, 0], [1, 10, 0], [0, 11, 0]], normals: [[0, 0, 1]], uvs: [[0, 0], [1, 0], [0, 1]],
      polys: [[[0, 0, 2], [1, 0, 0], [2, 0, 1], [2, 0, 1]]] } },
  ] } };
}

test('independent fixture dereferences distinct index streams without subtracting pivot', () => {
  const result = validateGeometry(fixture());
  assert.equal(result.geometries[0]!.triangles, 1);
  const p = decodeGeometryTriangles(result.file, 'geometry.calibration')[0]![0]!;
  assert.deepEqual(p.position, [0, 10, 0]); assert.deepEqual(p.uv, [0, 1]);
});

test('schema allows three-corner triangles and actual quads, not only padded triangles', () => {
  const file = fixture(), pm = file['geometry.calibration']!.bones[1]!.poly_mesh!;
  pm.polys[0] = [[0, 0, 0], [1, 0, 1], [2, 0, 2]];
  assert.equal(validateGeometry(file).geometries[0]!.triangles, 1);
  pm.positions.push([1, 11, 0]);
  pm.polys[0] = [[0, 0, 0], [1, 0, 1], [3, 0, 2], [2, 0, 2]];
  assert.equal(validateGeometry(file).geometries[0]!.triangles, 2);
  assert.equal(decodeGeometryTriangles(file, 'geometry.calibration').length, 2);
  pm.normalized_uvs = false; pm.uvs[0] = [2, 4];
  assert.deepEqual(decodeGeometryTriangles(file, 'geometry.calibration')[0]![0]!.uv, [0.5, 1]);
});

test('JSON syntax, dimensions, tuple shapes, nonfinite data and normal lengths are checked', () => {
  assert.throws(() => parseGeometryJSON('{"format_version":"1.8.0",}'));
  assert.throws(() => validateGeometry(fixture(), { textureSize: { width: 8, height: 8 } }), /PNG/);
  assert.throws(() => validateGeometry({ ...fixture(), format_version: '1.12.0' }), /format_version/);
  for (const kind of ['dimension', 'position', 'normal', 'uv'] as const) {
    const f = fixture(), g = f['geometry.calibration']!, pm = g.bones[1]!.poly_mesh!;
    if (kind === 'dimension') g.texturewidth = 0;
    if (kind === 'position') pm.positions[0]![1] = Infinity;
    if (kind === 'normal') pm.normals[0] = [0, 0, 0];
    if (kind === 'uv') pm.uvs[0] = [NaN, 0];
    assert.throws(() => validateGeometry(f));
  }
});

test('all index streams, noninteger indices, degenerate polygons and UV atlas bounds are checked', () => {
  for (let slot = 0; slot < 3; slot++) {
    const f = fixture(); f['geometry.calibration']!.bones[1]!.poly_mesh!.polys[0]![0][slot] = 999;
    assert.throws(() => validateGeometry(f), /index outside range/);
  }
  const fractional = fixture(); fractional['geometry.calibration']!.bones[1]!.poly_mesh!.polys[0]![0][0] = 0.5;
  assert.throws(() => validateGeometry(fractional), /index outside range/);
  const duplicate = fixture(); duplicate['geometry.calibration']!.bones[1]!.poly_mesh!.polys[0]![1][0] = 0;
  assert.throws(() => validateGeometry(duplicate), /repeats a position/);
  const collinear = fixture(); collinear['geometry.calibration']!.bones[1]!.poly_mesh!.positions[2] = [2, 10, 0];
  assert.throws(() => validateGeometry(collinear), /degenerate/);
  const uv = fixture(); uv['geometry.calibration']!.bones[1]!.poly_mesh!.uvs[0] = [2, 0];
  assert.throws(() => validateGeometry(uv, { atlasUVs: true }), /UV outside/);
  const quad = fixture(), pm = quad['geometry.calibration']!.bones[1]!.poly_mesh!;
  pm.positions.push([1, 11, 0], [0.5, 10.5, 0]);
  pm.polys[0] = [[0, 0, 0], [1, 0, 1], [3, 0, 2], [4, 0, 2]];
  assert.throws(() => validateGeometry(quad), /degenerate/);
});

test('bone uniqueness, parents, cycles, naming and expected geometry references are checked', () => {
  for (const kind of ['duplicate', 'missing', 'cycle'] as const) {
    const f = fixture(), b = f['geometry.calibration']!.bones;
    if (kind === 'duplicate') b[1]!.name = 'root';
    if (kind === 'missing') b[1]!.parent = 'unknown';
    if (kind === 'cycle') b[0]!.parent = 'body';
    assert.throws(() => validateGeometry(f), /duplicate|missing parent|cyclic/);
  }
  assert.throws(() => validateGeometry(fixture(), { expectedIdentifier: 'geometry.unknown' }), /identifier is missing/);
  assert.throws(() => validateGeometry({ format_version: '1.8.0', 'geometry.bad name': fixture()['geometry.calibration']! }), /identifier/);
});
