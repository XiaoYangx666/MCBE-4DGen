type Vector = { x: number; y: number; z: number };

export type CameraViewState = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
};

export function captureCameraView(
  position: Vector,
  target: Vector,
  up: Vector,
  zoom: number,
): CameraViewState {
  return {
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
    up: [up.x, up.y, up.z],
    zoom,
  };
}

export function restoreCameraView(
  state: CameraViewState,
  camera: {
    position: { set(x: number, y: number, z: number): unknown };
    up: { set(x: number, y: number, z: number): unknown };
    zoom: number;
    updateProjectionMatrix(): void;
  },
  controls: {
    target: { set(x: number, y: number, z: number): unknown };
    update(): void;
  },
) {
  camera.position.set(...state.position);
  camera.up.set(...state.up);
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  controls.target.set(...state.target);
  controls.update();
}
