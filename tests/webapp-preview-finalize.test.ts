import { test } from 'vitest';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';
import { finalizeConvertResult, type ConvertResult } from '../webapp/engine/convert.ts';

function geometry(): BedrockGeometryFile {
  return {
    format_version: '1.8.0',
    'geometry.skin0': {
      texturewidth: 2,
      textureheight: 2,
      bones: [{
        name: 'body',
        pivot: [0, 0, 0],
        poly_mesh: {
          normalized_uvs: true,
          positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
          normals: [[0, 0, 1]],
          uvs: [[0, 0], [1, 0], [0, 1]],
          polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2]]],
        },
      }],
    },
  };
}

async function png() {
  return new Uint8Array(
    await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer(),
  );
}

test('a preview result finalises into the exact same atlas without recomputation', async () => {
  const texture = await png();
  const preview: ConvertResult = {
    files: {},
    geometry: geometry(),
    png: texture,
    report: { triangles: 1 } as ConvertResult['report'],
    textureReport: {
      allocatedUtilization: 1,
      sampledUtilization: 1,
      size: 2,
      materials: [],
    },
    textureCoverage: 1,
    textureUrl: 'data:image/png;base64,preview',
    triangles: 1,
    binding: 'static',
    preview: true,
  };

  const final = finalizeConvertResult(preview, '预览复用');
  assert.equal(final.preview, false);
  assert.ok(Object.keys(final.files).length > 0);
  assert.deepEqual(final.png, texture);
  assert.deepEqual(final.geometry, preview.geometry);
  assert.equal(final.textureUrl, preview.textureUrl);

  // Finalising an already packed result is a no-op.
  assert.equal(finalizeConvertResult(final, '另一个名字'), final);
});
