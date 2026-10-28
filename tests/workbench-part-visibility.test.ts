import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PartSummary } from '../src/api-types.ts';
import {
  applyPartMeshState,
  collectPartMeshes,
} from '../web/workbench/part-visibility.ts';

function part(id: string, node: string, primitive: number): PartSummary {
  return {
    id,
    name: id,
    nodeIndex: Number(node.replace('node', '')),
    node,
    mesh: 'mesh',
    primitive,
    materialKey: `m:${id}#1`,
    materialName: id,
    triangles: 1,
    vertices: 3,
    instancePart: false,
  };
}

function geometry() {
  const value = new THREE.BufferGeometry();
  value.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  return value;
}

function mesh(materialIndex = 0) {
  const value = geometry();
  value.addGroup(0, 3, materialIndex);
  return new THREE.Mesh(value, new THREE.MeshBasicMaterial());
}

function firstGeometry() {
  const value = geometry();
  value.addGroup(0, 3, 0);
  value.addGroup(0, 3, 1);
  return value;
}

describe('desktop preview part filtering', () => {
  it('keeps and restores primitive draw groups', () => {
    const first = new THREE.Mesh(firstGeometry(), [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    const second = mesh(0);
    first.name = 'node0';
    second.name = 'node1';
    const scene = new THREE.Scene().add(first, second);
    const states = collectPartMeshes(scene, [
      part('p0.0', 'node0', 0),
      part('p0.1', 'node0', 1),
      part('p1.0', 'node1', 0),
    ]);
    expect(states).toHaveLength(2);
    expect(applyPartMeshState(states[0]!, (id) => id === 'p0.1')).toBe(true);
    expect(first.geometry.groups).toHaveLength(1);
    expect(first.geometry.groups[0]!.materialIndex).toBe(1);
    expect(applyPartMeshState(states[0]!, () => true)).toBe(true);
    expect(first.geometry.groups).toHaveLength(2);
    expect(applyPartMeshState(states[1]!, () => false)).toBe(false);
  });

  it('leaves meshes without part metadata untouched', () => {
    const scene = new THREE.Scene().add(mesh());
    expect(collectPartMeshes(scene, [])).toEqual([]);
  });
});
