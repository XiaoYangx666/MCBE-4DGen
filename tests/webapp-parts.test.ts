import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extractModel } from '../webapp/engine/extract.ts';
import { filterBatchParts, usedBatchParts } from '../webapp/engine/parts.ts';
import { extractedParts } from '../webapp/engine/parts.ts';

function triangle(offset: number, uv: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

function scene() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, name: 'Shared' });
  const scene = new THREE.Scene();
  const body = new THREE.Mesh(triangle(0, [0, 0, 0.2, 0, 0, 0.2]), material);
  body.name = 'body';
  const prop = new THREE.Mesh(triangle(3, [0.5, 0.5, 0.7, 0.5, 0.5, 0.7]), material);
  prop.name = 'prop';
  scene.add(body, prop);
  return scene;
}

describe('webapp part tracking', () => {
  it('records one part per mesh instance and keeps shared materials together', () => {
    const extracted = extractModel(scene());
    expect(extracted.batches).toHaveLength(1);
    const batch = extracted.batches[0]!;
    expect(batch.triangles).toBe(2);
    expect(batch.sourcePartTable?.map((part) => part.name)).toEqual(['body', 'prop']);
    expect(new Set(batch.sourcePartTable?.map((part) => part.id)).size).toBe(2);
    const parts = extractedParts(extracted);
    expect(parts.map((part) => part.name)).toEqual(['body', 'prop']);
    expect(parts.every((part) => part.materialName === 'Shared')).toBe(true);
  });

  it('drops only the excluded part and recomputes area and bounds', () => {
    const extracted = extractModel(scene());
    const batch = extracted.batches[0]!;
    const prop = batch.sourcePartTable!.find((part) => part.name === 'prop')!;
    const filtered = filterBatchParts(batch, new Set([prop.id]));
    expect(filtered).not.toBeNull();
    expect(filtered!.triangles).toBe(1);
    expect(filtered!.area).toBeCloseTo(0.5, 6);
    const bounds = filtered!.uvBounds!;
    expect(bounds[0]).toBeCloseTo(0.5, 6);
    expect(bounds[1]).toBeCloseTo(0.5, 6);
    expect(bounds[2]).toBeCloseTo(0.7, 6);
    expect(bounds[3]).toBeCloseTo(0.7, 6);
    expect(filtered!.sourcePartTable?.map((part) => part.name)).toEqual(['prop']);
    expect(filtered!.positions[0]).toBeCloseTo(3, 6);
    // The original batch is untouched.
    expect(batch.triangles).toBe(2);
    expect(usedBatchParts(batch)).toHaveLength(2);
  });

  it('returns null when every part is excluded', () => {
    const extracted = extractModel(scene());
    const batch = extracted.batches[0]!;
    const ids = batch.sourcePartTable!.map((part) => part.id);
    expect(filterBatchParts(batch, new Set())).toBeNull();
    expect(filterBatchParts(batch, new Set(ids))).toBe(batch);
  });
});
