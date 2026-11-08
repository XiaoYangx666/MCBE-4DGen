import * as THREE from 'three';

export interface PreviewPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Move a camera pose from one model's bounding sphere to another.
 *
 * Switching between the source model (metres) and the exported 4D output
 * (Minecraft blocks) changes the scale and centre. Mapping the camera *and*
 * the orbit target through the same scale/recenter transform keeps the exact
 * viewing angle and apparent size, and a source -> output -> source round trip
 * is exact even after panning. The camera is deliberately not rotated.
 */
export function mapPreviewPose(
  pose: PreviewPose,
  previous: THREE.Sphere,
  next: THREE.Sphere,
): PreviewPose {
  const scale = next.radius / previous.radius;
  const map = (point: THREE.Vector3) =>
    next.center
      .clone()
      .add(point.clone().sub(previous.center).multiplyScalar(scale));
  return { position: map(pose.position), target: map(pose.target) };
}
