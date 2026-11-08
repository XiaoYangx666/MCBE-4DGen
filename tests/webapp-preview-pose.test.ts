import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapPreviewPose } from '../webapp/lib/preview-pose.ts';

const sphere = (x: number, y: number, z: number, radius: number) =>
  new THREE.Sphere(new THREE.Vector3(x, y, z), radius);

describe('preview pose mapping', () => {
  it('round trips a panned camera pose exactly', () => {
    const source = sphere(12, 1.5, 4, 1.5);
    const output = sphere(0, 16, 0, 20);
    const pose = {
      position: new THREE.Vector3(7, 5, -9),
      target: new THREE.Vector3(1, 2, 3),
    };
    const outputPose = mapPreviewPose(pose, source, output);
    const back = mapPreviewPose(outputPose, output, source);
    expect(back.position.distanceTo(pose.position)).toBeLessThan(1e-9);
    expect(back.target.distanceTo(pose.target)).toBeLessThan(1e-9);
  });

  it('scales by the bounds ratio without rotating the view', () => {
    const source = sphere(0, 0, 0, 1);
    const output = sphere(0, 10, 0, 10);
    const pose = {
      position: new THREE.Vector3(4, 0, 0),
      target: new THREE.Vector3(0, 0, 0),
    };
    const mapped = mapPreviewPose(pose, source, output);
    // Distance 4 -> 40; the orbit direction stays exactly the same.
    expect(mapped.position.x).toBeCloseTo(40);
    expect(mapped.position.y).toBeCloseTo(10);
    expect(mapped.position.z).toBeCloseTo(0);
    expect(mapped.target.x).toBeCloseTo(0);
    expect(mapped.target.y).toBeCloseTo(10);
  });
});
